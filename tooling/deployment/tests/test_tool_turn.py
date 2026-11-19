"""Run tool-turn.sh against a fake container engine and check what each container mounts."""
import json
import os
from pathlib import Path
import socket
import stat
import re
import subprocess
from tempfile import TemporaryDirectory
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "bridge/tool-turn.sh"
RUN_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"

# Logs each call and binds the worker socket when the worker container starts.
FAKE_DOCKER = r'''#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> "$DOCKER_ARGS"
case "$*" in
  *" node --import tsx src/agents/shared-vm/tool-worker.ts")
    for arg in "$@"; do
      case "$arg" in *:/run/turn) rpc=${arg%%:/run/turn};; esac
    done
    python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "$rpc/worker.sock"
    echo worker-id;;
esac
exit 0
'''


# Creates directories for `install -d` and ignores ownership and mode, which need root.
FAKE_INSTALL = r'''#!/bin/sh
directory=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) directory=yes;;
    -m|-o|-g) shift;;
    *) [ "$directory" = yes ] && mkdir -p "$1";;
  esac
  shift
done
exit 0
'''


def exposes(source, policy):
    """Whether binding `source` would expose `policy`: the same path, a parent of it or a
    path inside it, compared after resolving `..`, `.` and symbolic links as the engine would."""
    source = os.path.realpath(source)
    policy = os.path.realpath(policy)
    return (source == policy or policy.startswith(source.rstrip("/") + "/")
            or source.startswith(policy + "/"))


class ToolTurnMounts(unittest.TestCase):
    def run_turn(self, provider="claude"):
        # One root per run, so a test can run a turn for each provider.
        root = Path(self.directory.name) / provider
        root.mkdir()
        guest = root / "guest-dir"
        (guest / "web").mkdir(parents=True)
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(str(guest / "web/reader.sock"))
        self.addCleanup(listener.close)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        for name, body in (("docker", FAKE_DOCKER), ("install", FAKE_INSTALL)):
            path = bin_dir / name
            path.write_text(body)
            path.chmod(path.stat().st_mode | stat.S_IXUSR)
        log = root / "docker.log"
        self.arguments = root / "docker-args.jsonl"
        env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "DOCKER_LOG": str(log),
               "DOCKER_ARGS": str(self.arguments), "TMPDIR": str(root)}
        subprocess.run(["sh", str(SCRIPT), str(guest), "runner:test", provider, RUN_ID],
                       env=env, check=True, capture_output=True, timeout=60)
        return [line for line in log.read_text().splitlines() if line.startswith("run ")]

    def bind_sources(self, name):
        """Every host path the named container binds, read from its exact arguments."""
        calls = [json.loads(line) for line in self.arguments.read_text().splitlines()]
        [call] = [call for call in calls if call[:1] == ["run"] and f"--name={name}" in call
                  or (call[:1] == ["run"] and "--name" in call
                      and call[call.index("--name") + 1] == name)]
        sources = []
        for flag, value in zip(call, call[1:], strict=False):
            if flag in ("-v", "--volume"):
                sources.append(value.split(":", 1)[0])
            elif flag == "--mount":
                fields = dict(field.split("=", 1) for field in value.split(",") if "=" in field)
                sources.append(fields.get("source") or fields.get("src") or "")
            elif flag.startswith("--volume="):
                sources.append(flag.split("=", 1)[1].split(":", 1)[0])
            elif flag.startswith("--mount="):
                fields = dict(field.split("=", 1) for field in flag[8:].split(",") if "=" in field)
                sources.append(fields.get("source") or fields.get("src") or "")
        return sources

    def setUp(self):
        # Unix socket paths are limited to about 100 bytes, so keep the root short.
        self.directory = TemporaryDirectory(prefix="tt-", dir="/tmp")
        self.addCleanup(self.directory.cleanup)

    def container(self, runs, suffix):
        name = f"bench-tool-{RUN_ID}{suffix} "
        matches = [run for run in runs if name in run + " "]
        self.assertEqual(len(matches), 1, runs)
        return matches[0]

    def test_policy_is_writable_by_the_supervisor_and_readable_by_egress_only(self):
        for provider in ("claude", "codex"):
            with self.subTest(provider=provider):
                self.check_policy_mounts(provider)

    def check_policy_mounts(self, provider):
        runs = self.run_turn(provider)
        peer = self.container(runs, "-peer")
        egress = self.container(runs, "-egress")
        worker = self.container(runs, "")
        written = re.search(r"--volume (\S+/policy):/run/policy( |$)", peer)
        read = re.search(r"--volume (\S+/policy):/run/policy:ro( |$)", egress)
        self.assertIsNotNone(written, peer)
        self.assertIsNotNone(read, egress)
        # The egress reads the very directory the supervisor writes.
        policy = written.group(1)
        self.assertEqual(os.path.realpath(policy), os.path.realpath(read.group(1)))
        # No worker bind exposes that directory, a parent of it, or anything inside it, under
        # any destination name.
        sources = self.bind_sources(f"bench-tool-{RUN_ID}")
        self.assertTrue(sources, "the worker's binds were not found")
        for source in sources:
            self.assertFalse(exposes(source, policy), f"worker mounts {source}")
        self.assertNotIn("/run/policy", worker)

    def test_exposure_check_sees_through_equivalent_paths(self):
        policy = os.path.join(self.directory.name, "turn", "policy")
        os.makedirs(policy)
        for source in (policy, policy + "/../policy", os.path.dirname(policy),
                       os.path.join(policy, "policy.json"), policy + "/./"):
            with self.subTest(source=source):
                self.assertTrue(exposes(source, policy))
        self.assertFalse(exposes(os.path.join(self.directory.name, "turn", "rpc"), policy))

    def test_egress_no_longer_receives_protected_hosts_from_the_environment(self):
        egress = self.container(self.run_turn(), "-egress")
        self.assertNotIn("INTAKE_VM_PROTECTED_HOSTS", egress)


if __name__ == "__main__":
    unittest.main()

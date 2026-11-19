"""Run tool-turn.sh against a fake container engine and check what each container mounts."""
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


class ToolTurnMounts(unittest.TestCase):
    def run_turn(self):
        root = Path(self.directory.name)
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
        env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "DOCKER_LOG": str(log),
               "TMPDIR": str(root)}
        subprocess.run(["sh", str(SCRIPT), str(guest), "runner:test", "claude", RUN_ID],
                       env=env, check=True, capture_output=True, timeout=60)
        return [line for line in log.read_text().splitlines() if line.startswith("run ")]

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
        runs = self.run_turn()
        peer = self.container(runs, "-peer")
        egress = self.container(runs, "-egress")
        worker = self.container(runs, "")
        written = re.search(r"--volume (\S+/policy):/run/policy( |$)", peer)
        read = re.search(r"--volume (\S+/policy):/run/policy:ro( |$)", egress)
        self.assertIsNotNone(written, peer)
        self.assertIsNotNone(read, egress)
        # The egress reads the very directory the supervisor writes.
        policy = written.group(1)
        self.assertEqual(policy, read.group(1))
        # No worker bind exposes that directory, under any path or through a parent.
        sources = re.findall(r"(?:--volume|-v) ([^:\s]+):", worker)
        sources += re.findall(r"source=([^,\s]+)", worker)
        for source in sources:
            self.assertFalse(policy == source or policy.startswith(source.rstrip("/") + "/"),
                             f"worker mounts {source}")
        self.assertNotIn("/run/policy", worker)

    def test_egress_no_longer_receives_protected_hosts_from_the_environment(self):
        egress = self.container(self.run_turn(), "-egress")
        self.assertNotIn("INTAKE_VM_PROTECTED_HOSTS", egress)


if __name__ == "__main__":
    unittest.main()

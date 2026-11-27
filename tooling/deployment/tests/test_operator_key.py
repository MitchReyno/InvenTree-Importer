"""Run operator-key.sh and the personal provisioning scripts against a fake guest, and check that
a key is made only when neither side has one and that neither key is ever replaced."""
import os
from pathlib import Path
import stat
import subprocess
from tempfile import TemporaryDirectory
import unittest

BRIDGE = Path(__file__).resolve().parents[1] / "bridge"

# `limactl shell --workdir=/ <vm> [sudo] <command...>` runs the command here. Docker is logged;
# `inspect` prints the mounts recorded for a container in $CONTAINERS, or fails when it has none.
FAKE_LIMACTL = r'''#!/bin/sh
shift 3
[ "$1" = sudo ] && shift
if [ "$1" = docker ]; then
  shift
  if [ "$1" = inspect ]; then
    for name; do :; done
    [ -f "$CONTAINERS/$name" ] || exit 1
    cat "$CONTAINERS/$name"
    exit 0
  fi
  printf '%s\n' "$*" >> "$DOCKER_LOG"
  exit 0
fi
exec "$@"
'''

# Creates directories for `install -d`, copies for a file install, and ignores ownership and mode.
FAKE_INSTALL = r'''#!/bin/sh
directory=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) directory=yes;;
    -m|-o|-g) shift;;
    *) if [ "$directory" = yes ]; then mkdir -p "$1"; else set -- "$@"; break; fi;;
  esac
  shift
done
[ "$directory" = yes ] && exit 0
cat "$1" > "$2"
'''

FAKE_SHA256SUM = '#!/bin/sh\nexec shasum -a 256 "$@"\n'

# Ownership and mode need root; the tests check contents only.
NO_OP = '#!/bin/sh\nexit 0\n'

# A guest whose shell checks fail, as when the VM stops answering.
FAILING_LIMACTL = r'''#!/bin/sh
shift 3
[ "$1" = sudo ] && shift
[ "$1" = sh ] && exit 255
exec "$@"
'''


def executable(path, text):
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class OperatorKey(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        root = Path(self.directory.name)
        self.bin = root / "bin"
        self.bin.mkdir()
        executable(self.bin / "limactl", FAKE_LIMACTL)
        executable(self.bin / "install", FAKE_INSTALL)
        executable(self.bin / "sha256sum", FAKE_SHA256SUM)
        executable(self.bin / "chown", NO_OP)
        executable(self.bin / "chmod", NO_OP)
        self.guest = root / "guest-dir"
        (self.guest / "guest").mkdir(parents=True)
        self.key_file = root / "host" / "vm-operator-key"
        self.key_file.parent.mkdir()
        self.docker_log = root / "docker.log"
        self.docker_log.touch()
        self.containers = root / "containers"
        self.containers.mkdir()

    def tearDown(self):
        self.directory.cleanup()

    @property
    def guest_key(self):
        return self.guest / "operator" / "key"

    def run_script(self, name, *args, **extra):
        env = {**extra,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "HOME": self.directory.name,
            "DOCKER_LOG": str(self.docker_log),
            "CONTAINERS": str(self.containers),
        }
        return subprocess.run(
            ["bash", str(BRIDGE / name), *args],
            env=env, capture_output=True, text=True, check=False,
        )

    def ensure_key(self):
        return self.run_script("operator-key.sh", "bench-agent-test", str(self.guest), str(self.key_file))

    def put_guest_key(self, text):
        self.guest_key.parent.mkdir(exist_ok=True)
        self.guest_key.write_text(text)

    def test_neither_side_makes_one_key_on_both(self):
        result = self.ensure_key()
        self.assertEqual(result.returncode, 0, result.stderr)
        host = self.key_file.read_text()
        self.assertRegex(host, r"^[0-9a-f]{64}\n$")
        self.assertEqual(self.guest_key.read_text(), host)

    def test_guest_key_without_host_file_is_refused_and_nothing_is_made(self):
        self.put_guest_key("guest-key\n")
        result = self.ensure_key()
        self.assertEqual(result.returncode, 3)
        self.assertIn("vm_operator_key_mismatch", result.stderr)
        self.assertFalse(self.key_file.exists())
        self.assertEqual(self.guest_key.read_text(), "guest-key\n")

    def test_different_keys_are_refused_and_neither_changes(self):
        self.put_guest_key("guest-key\n")
        self.key_file.write_text("host-key\n")
        result = self.ensure_key()
        self.assertEqual(result.returncode, 3)
        self.assertEqual(self.key_file.read_text(), "host-key\n")
        self.assertEqual(self.guest_key.read_text(), "guest-key\n")

    def test_host_key_without_guest_key_is_refused_and_not_installed(self):
        self.key_file.write_text("host-key\n")
        result = self.ensure_key()
        self.assertEqual(result.returncode, 3)
        self.assertIn("vm_operator_key_mismatch", result.stderr)
        self.assertFalse(self.guest_key.exists())
        self.assertEqual(self.key_file.read_text(), "host-key\n")

    def test_an_empty_guest_key_is_refused_and_not_replaced(self):
        for host in (None, "host-key\n"):
            with self.subTest(host=host):
                self.put_guest_key("")
                if host:
                    self.key_file.write_text(host)
                elif self.key_file.exists():
                    self.key_file.unlink()
                result = self.ensure_key()
                self.assertEqual(result.returncode, 3)
                self.assertEqual(self.guest_key.read_text(), "")
                self.assertEqual(self.key_file.exists(), host is not None)

    def test_a_failed_guest_check_stops_before_any_key_is_made(self):
        executable(self.bin / "limactl", FAILING_LIMACTL)
        result = self.ensure_key()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.key_file.exists())
        self.assertFalse(self.guest_key.exists())

    def test_matching_keys_change_nothing(self):
        self.put_guest_key("same-key\n")
        self.key_file.write_text("same-key\n")
        result = self.ensure_key()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.guest_key.read_text(), "same-key\n")

    def provision(self, provider):
        args = {
            "claude": ["personal-claude.sh", "bench-agent-test", str(self.guest), "runner:test",
                       str(self.key_file), "http://127.0.0.1:4330"],
            "codex": ["personal-codex.sh", "bench-agent-test", str(self.guest), "runner:test",
                      "http://127.0.0.1:4330", str(self.key_file)],
        }[provider]
        return self.run_script(*args)

    def test_provisioning_refuses_a_mismatched_key_before_any_container(self):
        for provider in ("claude", "codex"):
            with self.subTest(provider):
                self.put_guest_key("guest-key\n")
                self.key_file.write_text("host-key\n")
                result = self.provision(provider)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.docker_log.read_text(), "")
                self.assertEqual(self.guest_key.read_text(), "guest-key\n")

    def test_provisioning_replaces_only_its_own_containers_and_keeps_state(self):
        for provider, own, kept in (
            ("claude", "bench-claude-egress bench-claude-management bench-claude-catalog", "claude-store"),
            ("codex", "bench-codex-egress bench-codex-management", "codex-state"),
        ):
            with self.subTest(provider):
                self.docker_log.write_text("")
                # Both containers exist and belong to this installation.
                for name in own.split():
                    (self.containers / name).write_text(f"{self.guest}/{kept} ")
                (self.guest / kept).mkdir(exist_ok=True)
                (self.guest / kept / "sign-in").write_text("kept")
                result = self.provision(provider)
                self.assertEqual(result.returncode, 0, result.stderr)
                calls = self.docker_log.read_text().splitlines()
                self.assertEqual(calls[0], f"rm -f {own}")
                removals = [call for call in calls if call.startswith("rm")]
                self.assertEqual(removals, [f"rm -f {own}"])
                self.assertEqual((self.guest / kept / "sign-in").read_text(), "kept")

    def test_provisioning_refuses_containers_of_another_installation(self):
        for provider, name in (("claude", "bench-claude-management"), ("codex", "bench-codex-egress")):
            with self.subTest(provider):
                self.docker_log.write_text("")
                (self.containers / name).write_text("/home/dev/other-install/operator ")
                result = self.provision(provider)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"vm_guest_service_conflict: {name}", result.stderr)
                self.assertEqual(self.docker_log.read_text(), "")
                (self.containers / name).unlink()

    def test_verify_only_refuses_to_make_a_key_when_both_are_missing(self):
        result = self.run_script("operator-key.sh", "bench-agent-test", str(self.guest),
                                 str(self.key_file), INTAKE_OPERATOR_KEY_VERIFY_ONLY="1")
        self.assertEqual(result.returncode, 3)
        self.assertFalse(self.key_file.exists())
        self.assertFalse(self.guest_key.exists())

    def test_the_claude_catalogue_has_no_network_and_reads_the_store_only(self):
        # Its CLI holds the token, so like a turn it reaches only the Anthropic-only egress socket.
        self.docker_log.write_text("")
        result = self.provision("claude")
        self.assertEqual(result.returncode, 0, result.stderr)
        runs = [call for call in self.docker_log.read_text().splitlines() if call.startswith("run ")]
        catalog = [call for call in runs if "bench-claude-catalog" in call]
        self.assertEqual(len(catalog), 1)
        self.assertIn("--network=none", catalog[0])
        self.assertNotIn(" -p ", catalog[0])
        self.assertIn(f"type=bind,src={self.guest}/egress,dst=/run/egress,readonly", catalog[0])
        self.assertIn(f"type=bind,src={self.guest}/claude-store,dst=/run/claude-store,readonly", catalog[0])
        self.assertNotIn("/run/operator", catalog[0])
        management = [call for call in runs if "bench-claude-management" in call]
        self.assertNotIn("/run/egress", management[0])

    def test_only_the_management_containers_receive_the_pairing_identity(self):
        # The status-only endpoint authenticates as the paired guest; the egress services don't.
        pairing = f"type=bind,src={self.guest}/guest,dst=/run/bench-pair,readonly"
        for provider in ("claude", "codex"):
            with self.subTest(provider):
                self.docker_log.write_text("")
                result = self.provision(provider)
                self.assertEqual(result.returncode, 0, result.stderr)
                runs = [call for call in self.docker_log.read_text().splitlines()
                        if call.startswith("run ")]
                management = [call for call in runs if f"bench-{provider}-management" in call]
                egress = [call for call in runs if f"bench-{provider}-egress" in call]
                self.assertEqual(len(management), 1)
                self.assertEqual(len(egress), 1)
                self.assertIn(pairing, management[0])
                self.assertNotIn("/run/bench-pair", egress[0])
                self.assertNotIn(f"{self.guest}/guest,", egress[0])
                # Nothing is published for it: only the management port is.
                self.assertEqual(management[0].count(" -p "), 1)

    def test_a_container_without_mounts_is_not_removed(self):
        (self.containers / "bench-claude-egress").write_text(" ")
        result = self.provision("claude")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("vm_guest_service_conflict: bench-claude-egress", result.stderr)
        self.assertEqual(self.docker_log.read_text(), "")


if __name__ == "__main__":
    unittest.main()

"""One serial SDK child, nonblocking bounded datagrams, explicit cancel channel."""
from __future__ import annotations

import json
from pathlib import Path
import socket
import subprocess
import sys
from threading import Thread

from invimport.demo.runner import child_environment
from invimport.demo.workspace import load_workspace


class Child:
    def __init__(self, path: Path, key: str, *, action: str = "start", operation: str = "",
                 continuity_reason: str = "", observer=None):
        path, manifest = load_workspace(path)
        environment = child_environment(path, manifest)
        environment["PYTHONPATH"] += ":" + str(Path(__file__).parent)
        self.events, sender = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.events.settimeout(0.1)
        environment["SPIKE_OBSERVATION_FD"] = str(sender.fileno())
        self.received = 0
        self.observer_failures = 0
        self.process = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name("worker.py")), str(path), key,
             action, operation, continuity_reason], cwd=path, env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            pass_fds=(sender.fileno(),), text=True)
        sender.close()

        def drain():
            while self.process.poll() is None:
                try:
                    packet = self.events.recv(4096)
                except socket.timeout:
                    continue
                except OSError:
                    return  # Child exit/closed IPC never changes canonical state.
                try:
                    event = json.loads(packet)
                    self.received += 1
                    if observer:
                        observer(event)
                except Exception:
                    # Projection/renderer code cannot signal cancellation or
                    # alter semantic execution. Slow observers merely drop IPC.
                    self.observer_failures += 1
        self.reader = Thread(target=drain, daemon=True)
        self.reader.start()

    def cancel(self) -> None:
        if self.process.poll() is None:
            try:
                self.process.stdin.write("cancel\n")
                self.process.stdin.flush()
            except BrokenPipeError:
                pass

    def wait(self, timeout_seconds: float = 60) -> dict:
        # No automatic kill/replay on timeout: caller must retain ownership and
        # inspect/cancel this same child. In-flight accepted writes are not undoable.
        self.process.wait(timeout=timeout_seconds)
        self.reader.join(timeout=1)
        self.events.close()
        stdout, stderr = self.process.communicate()
        if self.process.returncode:
            raise RuntimeError(stderr.strip() or "child failed; inspect canonical state")
        return json.loads(stdout)


def snapshot(path: Path, key: str) -> dict:
    """A fresh local child reads canonical status, not a result export/event tail."""
    path, manifest = load_workspace(path)
    environment = child_environment(path, manifest)
    environment["PYTHONPATH"] += ":" + str(Path(__file__).parent)
    result = subprocess.run([sys.executable, str(Path(__file__).with_name("worker.py")),
                             str(path), key, "status", "", ""], env=environment, cwd=path,
                            capture_output=True, text=True, timeout=20, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)

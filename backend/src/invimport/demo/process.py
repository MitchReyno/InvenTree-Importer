"""Bounded child lifecycle with cooperative interruption and guaranteed reaping."""
from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess


def _interrupt(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
    else:
        # Windows has no POSIX process-group SIGINT. Retain conservative unknown
        # journal state if a cooperative console signal is unavailable.
        process.terminate()


def _reap(process: subprocess.Popen) -> str:
    try:
        stdout, _ = process.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            stdout, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, _ = process.communicate()
    return stdout


def run_child(command: list[str], environment: dict[str, str], directory: Path, *,
              timeout_seconds: float = 300) -> subprocess.CompletedProcess:
    with subprocess.Popen(command, env=environment, cwd=directory, text=True,
                          stdout=subprocess.PIPE, start_new_session=os.name == "posix") as process:
        try:
            stdout, _ = process.communicate(timeout=timeout_seconds)
        except KeyboardInterrupt:
            # Terminal/group SIGINT reaches the wrapper once. The separately
            # grouped child gets one forwarded signal, then settles/reaps before
            # locator recovery. A second interrupt cannot strand that cleanup.
            previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
            try:
                _interrupt(process)
                stdout = _reap(process)
            finally:
                signal.signal(signal.SIGINT, previous)
            return subprocess.CompletedProcess(command, 130, stdout)
        except subprocess.TimeoutExpired:
            _interrupt(process)
            _reap(process)
            raise
    return subprocess.CompletedProcess(command, process.returncode, stdout)

"""Private supervised child entrypoint. Only synthetic owned targets are allowed."""
from __future__ import annotations

from dataclasses import asdict
from hashlib import sha256
import json
import os
from pathlib import Path
import socket
import sys
from threading import Event, Thread

from invimport.execution.adoption import inspect_binding
from invimport.execution.executor import ContinuityReview
from invimport.execution.observation import Observation, observing
from invimport.execution.ownership import FileLock, JournalError, state_root
from invimport.execution.run_control import inspect_run, record_continuity
from invimport.execution.stock_workflow import repair_stock

from adapter import fake_api, load_intent, start_or_adopt


def run(path: Path, key: str, action: str, operation: str, reason: str) -> dict:
    if state_root().resolve() != (path / "state").resolve():
        raise ValueError("private state binding required")
    cancelled = Event()
    sender = socket.socket(fileno=int(os.environ["SPIKE_OBSERVATION_FD"])) if "SPIKE_OBSERVATION_FD" in os.environ else None
    if sender:
        sender.setblocking(False)
    dropped = 0

    def emit(event):
        nonlocal dropped
        payload = json.dumps(asdict(event), allow_nan=False).encode()
        if sender:
            try:
                if len(payload) > 4096:
                    dropped += 1
                else:
                    sender.send(payload)
            except OSError:
                dropped += 1

    observation = Observation(emit)
    if action != "status":
        def cancellation():
            # Supervisor loss closes stdin: stop new work, never assume rollback.
            sys.stdin.readline()
            cancelled.set()
            observation.emit("cancellation_received", "cancelled")
        Thread(target=cancellation, daemon=True).start()
    try:
        with observing(observation):
            if action == "start":
                result = start_or_adopt(path, key, cancelled=cancelled)
                return {"adopted": result["adopted"], "run_id": result["snapshot"]["run_id"], "ipc_dropped": dropped}
            plan, directory = load_intent(path, key)
            if action == "status":
                bound = inspect_binding(plan, directory)
                if bound is None or bound.snapshot is None:
                    raise JournalError("no initialized canonical journal; recovery required")
                return inspect_run(bound.run_id)
            if action != "repair" or not reason.strip():
                raise ValueError("selected repair requires continuity review")
            with FileLock(path / "apply.lock"):
                bound = inspect_binding(plan, directory)
                if bound is None or bound.snapshot is None:
                    raise JournalError("canonical journal unavailable")
                api, target = fake_api(path)
                record_continuity(bound.run_id, plan, reason=reason)
                review = ContinuityReview(plan.revision, target.endpoint, sha256(reason.encode()).hexdigest())
                result = repair_stock(plan, bound.run_id, directory / "run.sqlite3", operation,
                                      api=api, current_target=target, continuity=review, cancelled=cancelled)
                return {"run_id": result["run_id"], "ipc_dropped": dropped}
    finally:
        if sender:
            sender.close()


if __name__ == "__main__":
    try:
        output = run(Path(sys.argv[1]), *sys.argv[2:])
    except Exception as exc:
        # No untrusted exception bodies, SDK credentials or response payloads.
        print(type(exc).__name__ + ": inspect retained canonical state", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(output, allow_nan=False), flush=True)

"""One connected retained-observation journey and asymmetric real seam faults."""

import argparse
import copy
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from threading import Event
import time

from seams.bootstrap import paths, setup, system_url

paths()
from coordination.boundary import canonical, decode, sha  # noqa: E402
from seams.observations import emissions, messages, stage  # noqa: E402

HERE = Path(__file__).resolve().parent


def wait_for(predicate, description: str, *, seconds: float = 40) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise TimeoutError(description)


def rejected(operation, description: str) -> None:
    try:
        operation()
    except ValueError:
        return
    raise AssertionError("accepted " + description)


class Processes:
    def __init__(self, state: Path, environment: dict) -> None:
        self.state = state
        self.environment = environment
        self.worker = None
        self.logs = []

    def cli(self, *args: str, expected: int = 0) -> subprocess.CompletedProcess:
        result = subprocess.run([sys.executable, str(HERE / "entry.py"), *args],
                                env=self.environment, capture_output=True, text=True, timeout=40)
        with (self.state / "commands.log").open("a", encoding="utf-8") as log:
            log.write(json.dumps({"args": args, "code": result.returncode,
                                  "stdout": result.stdout, "stderr": result.stderr}) + "\n")
        assert result.returncode == expected, result.stdout + result.stderr
        return result

    def start(self, *, pause_result: str = "", reservation: str = "") -> Path:
        if self.worker is not None:
            raise ValueError("owned worker already running")
        log = self.state / f"worker-{len(self.logs)}.log"
        self.logs.append(log)
        environment = dict(self.environment, COMBINED_PAUSE_RESULT=pause_result,
                           COMBINED_RESERVATION_DEATH=reservation)
        with log.open("w", encoding="utf-8") as output:
            self.worker = subprocess.Popen([sys.executable, str(HERE / "entry.py"), "worker"],
                                           env=environment, stdout=output, stderr=subprocess.STDOUT)
        wait_for(lambda: "WORKER_READY" in log.read_text(encoding="utf-8"), "worker readiness")
        return log

    def stop(self) -> int | None:
        if self.worker is None:
            return None
        self.worker.kill()
        result = self.worker.wait(timeout=15)
        self.worker = None
        return result


def exercise(processes: Processes) -> dict:
    from dbos import DBOSClient
    from django.db import connection, transaction
    from adapter import load_intent
    from coordination.models import Emission, Intent, Job, Outbox, Question
    from coordination.store import accept, workflow_id
    from invimport.demo.workspace import save_json
    from seams.models import Approval, ApplyOutbox, Projection
    from seams.runtime import export_approval
    from seams.store import QUEUE, VERSION, WORKFLOW, answer, approve, submit
    from seams.target import initialize, inspect_approval, running, selected_plan
    from supervisor import Child, snapshot

    bundle = processes.state / "bundle"
    request = messages()[0]
    reply = next(item for item in messages() if item["type"] == "job.answer")
    request_file = processes.state / "request.json"
    answer_file = processes.state / "answer.json"
    save_json(request_file, request)
    save_json(answer_file, reply)

    def runtime_rows() -> list[dict]:
        with connection.cursor() as cursor:
            cursor.execute("SELECT workflow_uuid,status,application_version,recovery_attempts FROM dbos.workflow_status ORDER BY workflow_uuid")
            return [dict(zip(("id", "status", "version", "recoveries"), row, strict=True)) for row in cursor.fetchall()]

    def completed(identifier: str, status: str = "SUCCESS") -> bool:
        return any(row["id"] == identifier and row["status"] == status for row in runtime_rows())

    def settle(identifier: str) -> dict:
        wait_for(lambda: completed(identifier), "DBOS command " + identifier)
        row = Projection.objects.get(pk=identifier)
        return {"disposition": row.disposition, "cursor": row.cursor, "snapshot": row.snapshot}

    def commit(path: Path, selected: list[str], *, known_part=None, kill: bool = False) -> tuple:
        plan, binding = selected_plan(path, selected, known_part=known_part)
        prepared = processes.state / f"prepare-{len(list(processes.state.glob('prepare-*.json')))}.json"
        save_json(prepared, {"research": research, "workspace": str(path), "plan": plan.dumps(), "binding": binding})
        result = processes.cli("approve", "--file", str(prepared), "--principal", "fixture-user",
                               *(["--kill-at", "approval-commit"] if kill else []), expected=-9 if kill else 0)
        key = result.stdout.strip().splitlines()[-1]
        assert Approval.objects.get(pk=key).payload["plan"] == plan.dumps()
        assert ApplyOutbox.objects.filter(pk=key, acknowledged=False).exists()
        assert not (path / "intents" / (key + ".json")).exists()
        return plan, key

    with connection.cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='dbos')")
        assert cursor.fetchone()[0] is False
    # Baseline seam gap: the unchanged 1B facade accepts synthetic fixture requests only.
    from coordination.store import submit as original_submit
    rejected(lambda: original_submit(canonical(request), bundle=bundle), "retained provider request at fixture-only baseline")
    assert not Intent.objects.exists()
    try:
        with transaction.atomic():
            submit(request, bundle)
            raise RuntimeError("authored rollback")
    except RuntimeError:
        pass
    assert not Intent.objects.exists() and not Outbox.objects.exists() and not Job.objects.exists()
    processes.start()
    processes.cli("submit", "--file", str(request_file))
    first = workflow_id(request)
    assert submit(request, bundle) == first
    rejected(lambda: submit(request, bundle, version="changed-runtime"), "changed command version")
    changed = copy.deepcopy(request)
    changed["allowed_capabilities"] = ["read_evidence"]
    rejected(lambda: submit(changed, bundle), "changed command payload")
    processes.cli("dispatch")
    wait_for(lambda: completed(first), "persisted question releases lane")
    assert Job.objects.get(pk=f"{request['batch_id']}:{request['job_id']}").state == "waiting_for_user"
    assert Question.objects.get(intent_id=first).answer is None
    assert Emission.objects.filter(intent_id=first).count() == len(emissions("attempt-1"))
    assert accept(first, canonical(emissions("attempt-1")[0]), bundle=bundle) == "duplicate"
    changed_event = {**emissions("attempt-1")[0], "code": "authored_conflict"}
    rejected(lambda: accept(first, canonical(changed_event), bundle=bundle), "conflicting event sequence")
    # A real queued command (authored control, NOT another provider run) uses the released lane.
    client = DBOSClient(system_database_url=system_url())
    try:
        client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                        "workflow_id": "serial-lane-control", "app_version": VERSION},
                       "control", "serial-lane-control", "authored-control")
        wait_for(lambda: completed("serial-lane-control"), "serial control while question unanswered")
    finally:
        client.destroy()
    rejected(lambda: answer(reply, bundle, principal="stranger"), "unprivileged answer")
    wrong = {**reply, "question_revision": 2}
    rejected(lambda: answer(wrong, bundle, principal="fixture-user"), "stale question revision")
    original = bytes(Intent.objects.get(pk=first).input_bytes)
    research = processes.cli("answer", "--file", str(answer_file), "--principal", "fixture-user").stdout.strip()
    assert research != first and bytes(Intent.objects.get(pk=first).input_bytes) == original
    assert bytes(Intent.objects.get(pk=research).input_bytes) == (bundle / "input-confirmed.json").read_bytes()
    rejected(lambda: answer(reply, bundle, principal="fixture-user"), "stale answered attempt")
    rejected(lambda: accept(first, canonical(emissions("attempt-1")[-1]), bundle=bundle), "obsolete result")
    old_input_result = {**emissions("attempt-2")[-1], "input_revision": request["input_revision"]}
    rejected(lambda: accept(research, canonical(old_input_result), bundle=bundle), "old input on current attempt")
    processes.cli("dispatch")
    wait_for(lambda: completed(research), "accepted retained proposal")
    validation = decode((bundle / "validation.json").read_bytes())
    assert validation["ok"] and validation["validation_report"].count("has no sku") == 2
    assert validation["proposal_sha256"] == "ecb0bd329d564581179ddf22ad7e9bfe92c7f7f2556fc9fa60924ea51fe4cfd5"
    assert Question.objects.get(intent_id=first).answer == reply

    path = initialize(processes.state / "journey")
    with running(path) as (state, _server):
        plan, binding = selected_plan(path, ["lot-a"])
        rejected(lambda: approve(research, path, plan, binding, principal="stranger"), "unprivileged approval")
        try:
            with transaction.atomic():
                approve(research, path, plan, binding, principal="fixture-user")
                raise RuntimeError("approval rollback")
        except RuntimeError:
            pass
        assert not Approval.objects.exists() and not ApplyOutbox.objects.exists()
        _plan, key = commit(path, ["lot-a"], kill=True)
        assert not state.rows("stock/") and not state.rows("part/")
        processes.stop()
        # DBOS persists enqueue even while its worker is stopped; ACK transaction rolls back.
        processes.cli("dispatch", "--kill-at", "enqueue-before-ack", expected=-9)
        assert not ApplyOutbox.objects.get(pk=key).acknowledged
        assert not state.rows("stock/")
        log = processes.start(pause_result=key)
        wait_for(lambda: "ENGINE_RESULT_UNPUBLISHED" in log.read_text(encoding="utf-8"), "engine result publication gap")
        assert not Projection.objects.filter(pk=key).exists()
        prior = snapshot(path, key)
        before = state.inspect()["records"]
        assert len(state.rows("stock/")) == 1
        assert processes.stop() == -9
        processes.cli("dispatch")
        assert ApplyOutbox.objects.get(pk=key).acknowledged
        processes.start()
        recovered = settle(key)
        assert recovered["snapshot"]["run_id"] == prior["run_id"]
        assert state.inspect()["records"] == before
        assert all(row["state"] in {"succeeded", "already_satisfied", "skipped"} for row in recovered["snapshot"]["operations"])
        # Projection is disposable: drop it, recover from canonical state without mutation.
        Projection.objects.filter(pk=key).delete()
        processes.cli("reconcile", "--key", key)
        assert Projection.objects.get(pk=key).snapshot["run_id"] == prior["run_id"]
        assert state.inspect()["records"] == before
        part = state.rows("part/")[0]
        second, key2 = commit(path, ["lot-b"], known_part=(part["pk"], part["IPN"]))
        assert second.import_id == plan.import_id == "SPIKE-TWO-LOTS-001"
        assert second.decisions.values()["sources"]["lot-b"]["stock_key"] == "invimport:SPIKE-TWO-LOTS-001:lot-b"
        processes.cli("dispatch")
        settle(key2)
        assert len(state.rows("part/")) == 1 and len(state.rows("stock/")) == 2
        assert {row["quantity"] for row in state.rows("stock/")} == {10, 20}
        assert {row["batch"] for row in state.rows("stock/")} == {"SPIKE-A", "SPIKE-B"}
        assert set(state.inspect()["barcodes"]) == {"invimport:SPIKE-TWO-LOTS-001:lot-a", "invimport:SPIKE-TWO-LOTS-001:lot-b"}
        assert not state.rows("company/part/")
        assert all(row["filename"] != "receipt.pdf" for row in state.rows("attachment/"))
        assert Child(path, key).wait()["run_id"] == prior["run_id"]
        journey = {"approval": key, "run": prior["run_id"], "round_two": key2, "records": state.inspect()["records"]}

    # A separate NEW target/state, same accepted provider output, actual canonical reservation SIGKILL.
    processes.stop()
    reserved = initialize(processes.state / "reservation")
    with running(reserved) as (state, _server):
        _plan, key = commit(reserved, ["lot-a"])
        processes.start(reservation=key)
        processes.cli("dispatch")
        disposition = settle(key)
        assert disposition["disposition"] == "recovery_required" and disposition["snapshot"] is None
        assert not state.rows("stock/") and not state.rows("part/")
        try:
            Child(reserved, key).wait()
        except RuntimeError as exc:
            assert "JournalError" in str(exc)
        else:
            raise AssertionError("reservation death allocated new journal")
        reserved_binding = inspect_approval(reserved, key)
        assert reserved_binding["state"] == "recovery_required" and reserved_binding["snapshot"] is None
        assert reserved_binding["run_id"]
        assert not (reserved / "state/execution/runs" / key / "run.sqlite3").exists()
    processes.stop()
    processes.start()
    adverse = []
    for route in ("stock/", "attachment/"):
        path = initialize(processes.state / ("lost-" + route.strip("/")))
        with running(path) as (state, server):
            _plan, key = commit(path, ["lot-a"])
            server.arm(route, "lose_ack")
            processes.cli("dispatch")
            initial = settle(key)["snapshot"]
            unknown = [row for row in initial["operations"] if row["result"] and row["result"]["certainty"] == "unknown"]
            assert unknown
            records = state.inspect()["records"]
            assert Child(path, key).wait()["adopted"]
            assert state.inspect()["records"] == records
            part = state.rows("part/")[0]
            _later, later_key = commit(path, ["lot-b"], known_part=(part["pk"], part["IPN"]))
            processes.cli("dispatch")
            assert settle(later_key)["disposition"] == "recovery_required"
            assert state.inspect()["records"] == records
        # Restart same listener/nonce/consumed fault, selected repair under original approval/run.
        with running(path) as (state, _server):
            Child(path, key, action="repair", operation=unknown[0]["id"],
                  continuity_reason="Reviewed owned fake nonce, canonical history and selected original effect").wait()
            processes.cli("reconcile", "--key", key)
            after = Projection.objects.get(pk=key).snapshot
            assert after["run_id"] == initial["run_id"]
            assert state.inspect()["records"] == records
            assert any(row["state"] == "exchange_unknown" for row in after["requests"])
            assert any(row["state"] == "uncertain" for row in after["attempts"])
            if route == "stock/":
                assert any(row["state"] in {"uncertain", "needs_review"} for row in after["operations"])
                assert len(state.rows("stock/")) == 1
                # Authored external-deletion asymmetry, confined to this owned fake.
                with state.connect() as database:
                    database.execute("DELETE FROM records WHERE route='stock/'")
                sent = len([row for row in state.inspect()["requests"] if row["method"] == "POST" and row["route"] == "stock/"])
                Child(path, key, action="repair", operation=unknown[0]["id"],
                      continuity_reason="Reviewed vanished unknown create; absence does not authorize recreation").wait()
                assert not state.rows("stock/")
                assert len([row for row in state.inspect()["requests"] if row["method"] == "POST" and row["route"] == "stock/"]) == sent
                try:
                    Child(path, later_key).wait()
                except RuntimeError as exc:
                    assert "OwnershipError" in str(exc)
                else:
                    raise AssertionError("vanished unknown effect cleared earlier ownership")
                processes.cli("reconcile", "--key", key)
                after = Projection.objects.get(pk=key).snapshot
            else:
                assert all(row["state"] in {"succeeded", "already_satisfied", "skipped"} for row in after["operations"])
                # Explicitly run the already approved later round after supported settlement.
                Child(path, later_key).wait()
                processes.cli("reconcile", "--key", later_key)
                assert len(state.rows("part/")) == 1 and len(state.rows("stock/")) == 2
            adverse.append({"route": route, "approval": key, "run": after["run_id"],
                            "later_approval": later_key, "operations": after["operations"]})

    # Direct supervised-child adverse control consumes a PostgreSQL approval, not a file approval.
    path = initialize(processes.state / "cancel")
    with running(path) as (state, server):
        _plan, key = commit(path, ["lot-a"])
        row = Approval.objects.get(pk=key)
        export_approval(row)
        load_intent(path, key)
        server.arm("stock/", "hold_ack")
        cancelled = Event()
        child = Child(path, key, observer=lambda event: cancelled.set() if event["kind"] == "cancellation_received" else None)
        try:
            wait_for(lambda: any(row["outcome"] == "hold_ack" for row in state.inspect()["requests"]), "accepted stock request")
            processes.cli("dispatch")
            assert settle(key)["disposition"] == "recovery_required"  # Surviving child excludes DBOS redelivery.
            child.cancel()
            assert cancelled.wait(timeout=3)
        finally:
            server.release_ack.set()
            child.wait()
        requests = state.inspect()["requests"]
        held = next(row["id"] for row in requests if row["outcome"] == "hold_ack")
        assert not any(row["method"] in {"POST", "PATCH"} for row in requests if row["id"] > held)
        assert len(state.rows("stock/")) == 1
        processes.cli("reconcile", "--key", key)
        assert Projection.objects.get(pk=key).snapshot["run_id"] == snapshot(path, key)["run_id"]

    path = initialize(processes.state / "dropped-progress")
    released = Event()
    with running(path) as (state, _server):
        _plan, key = commit(path, ["lot-a"])
        export_approval(Approval.objects.get(pk=key))
        child = Child(path, key, observer=lambda _event: released.wait(10))
        try:
            dropped = child.wait()
        finally:
            released.set()
            child.reader.join(timeout=2)
        assert dropped["ipc_dropped"] > 0
        records = state.inspect()["records"]
        assert len(state.rows("stock/")) == 1
        processes.cli("dispatch")  # Durable command adopts this exact original run, not a retry.
        recovered = settle(key)["snapshot"]
        assert recovered["run_id"] == dropped["run_id"]
        assert len(recovered["operations"]) > child.received
        assert state.inspect()["records"] == records

    # Changed runtime arguments on a correct approval ID: never ACK/adopt its meaning.
    path = initialize(processes.state / "runtime-conflict")
    with running(path) as (state, _server):
        _plan, key = commit(path, ["lot-a"])
        row = Approval.objects.get(pk=key)
        client = DBOSClient(system_database_url=system_url())
        try:
            client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                            "workflow_id": key, "app_version": VERSION}, "apply", key, "wrong-payload")
        finally:
            client.destroy()
        processes.cli("dispatch", expected=1)
        wait_for(lambda: completed(key, "ERROR"), "conflicting runtime rejection")
        assert ApplyOutbox.objects.get(pk=key).conflict == "runtime_metadata_conflict"
        assert not ApplyOutbox.objects.get(pk=key).acknowledged
        assert not state.rows("part/") and not state.rows("stock/")
        assert Question.objects.get(intent_id=first).answer == reply

    path = initialize(processes.state / "runtime-version-conflict")
    with running(path) as (state, _server):
        _plan, version_key = commit(path, ["lot-a"])
        row = Approval.objects.get(pk=version_key)
        client = DBOSClient(system_database_url=system_url())
        try:
            client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                            "workflow_id": version_key, "app_version": "incompatible-v2"},
                           "apply", version_key, row.command_digest)
        finally:
            client.destroy()
        processes.cli("dispatch", expected=1)
        assert ApplyOutbox.objects.get(pk=version_key).conflict == "runtime_metadata_conflict"
        assert not ApplyOutbox.objects.get(pk=version_key).acknowledged
        assert not state.rows("stock/") and not state.rows("part/")
        assert not Projection.objects.filter(pk=version_key).exists()
        # It stays ENQUEUED under the wrong version; no incompatible worker is run here.
        assert completed(version_key, "ENQUEUED")

    client = DBOSClient(system_database_url=system_url())
    try:
        client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                        "workflow_id": "healthy-after-conflicts", "app_version": VERSION},
                       "control", "healthy-after-conflicts", "authored-control")
        wait_for(lambda: completed("healthy-after-conflicts"), "healthy work after quarantined commands")
    finally:
        client.destroy()
    processes.cli("dispatch", expected=1)
    assert ApplyOutbox.objects.filter(conflict="runtime_metadata_conflict", acknowledged=False).count() == 2

    return {"evidence_type": "retained-provider-observation-replay + authored-adverse-controls + real-PG-Django-DBOS-SDK-persistent-fake",
            "validation": validation, "journey": journey, "adverse": adverse,
            "reservation": reserved_binding, "dropped_progress": dropped,
            "workflows": runtime_rows(), "research_intents": list(Intent.objects.values("id", "payload__input_revision", "app_version")),
            "research_emissions": Emission.objects.count(), "approvals": Approval.objects.count(),
            "apply_outbox": list(ApplyOutbox.objects.values()),
            "projections": list(Projection.objects.values("approval_id", "cursor", "disposition"))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    state = parser.parse_args().state.resolve()
    state.mkdir(mode=0o700, parents=True, exist_ok=False)
    initdb, pg_ctl = shutil.which("initdb"), shutil.which("pg_ctl")
    if not initdb or not pg_ctl:
        raise RuntimeError("PostgreSQL 14+ binaries required; no existing service fallback")
    stage(state / "bundle")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    environment = dict(os.environ, COMBINED_PG_PORT=str(port), COMBINED_BUNDLE=str(state / "bundle"))
    for key in list(environment):
        if key.startswith(("PG", "DBOS_")) or key == "DATABASE_URL":
            del environment[key]
    os.environ["COMBINED_PG_PORT"] = str(port)
    os.environ["COMBINED_BUNDLE"] = str(state / "bundle")
    processes = Processes(state, environment)
    cluster = state / "pg"
    with (state / "initdb.log").open("w", encoding="utf-8") as output:
        subprocess.run([initdb, "-D", str(cluster), "--username=combined_spike", "--auth=trust",
                        "--no-locale", "--encoding=UTF8"], env=environment, stdout=output,
                       stderr=subprocess.STDOUT, check=True, timeout=30)
    try:
        subprocess.run([pg_ctl, "-D", str(cluster), "-l", str(state / "postgres.log"),
                        "-o", f"-h 127.0.0.1 -p {port} -k ''", "-w", "start"],
                       env=environment, check=True, timeout=30)
        import psycopg
        with psycopg.connect(host="127.0.0.1", port=port, user="combined_spike", dbname="postgres", autocommit=True) as db:
            db.execute("CREATE DATABASE combined_spike")
        processes.cli("migrate")
        setup()
        report = exercise(processes)
        report["versions"] = {name: importlib.metadata.version(name) for name in ("dbos", "django", "psycopg", "inventree", "pint", "pypdf")}
        report["postgres"] = subprocess.check_output([initdb, "--version"], text=True).strip()
        report["combined_lock_sha256"] = sha((HERE / "uv.lock").read_bytes())
        (state / "evidence.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
    finally:
        processes.stop()
        if (cluster / "postmaster.pid").exists():
            subprocess.run([pg_ctl, "-D", str(cluster), "-m", "fast", "-w", "stop"], env=environment, check=True, timeout=30)


if __name__ == "__main__":
    main()

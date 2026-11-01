"""Real process/transaction probe. Creates a NEW owned persistent PostgreSQL cluster.

No connection to an existing service is accepted. A successful run stops its own
cluster but retains database files, logs and a machine-readable evidence report.
"""

import argparse
import copy
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from inspect import unwrap
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from coordination.boundary import FIXTURE, canonical, decode, sha, transcript

HERE = Path(__file__).resolve().parent


def wait_for(predicate, description: str, *, seconds: float = 30) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise TimeoutError(description)


class Processes:
    def __init__(self, state: Path, env: dict) -> None:
        self.state = state
        self.env = env
        self.worker = None
        self.logs = []

    def cli(self, *args: str, killed: bool = False, failed: bool = False) -> subprocess.CompletedProcess:
        result = subprocess.run(
            [sys.executable, str(HERE / "entry.py"), *args], env=self.env,
            text=True, capture_output=True, timeout=30,
        )
        if killed:
            assert result.returncode == -9, result.stderr
        elif failed:
            assert result.returncode == 1, result.stdout + result.stderr
        elif result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        return result

    def start(self, version: str = "coordination-v1", *, pause: str = "", after_result: str = "") -> None:
        if self.worker is not None:
            raise RuntimeError("Stop owned worker before replacing it")
        path = self.state / f"worker-{len(self.logs)}.log"
        self.logs.append(path)
        env = dict(self.env, COORDINATION_PAUSE_WORKFLOW=pause,
                   COORDINATION_PAUSE_AFTER_RESULT=after_result)
        with path.open("w", encoding="utf-8") as output:
            self.worker = subprocess.Popen(
                [sys.executable, str(HERE / "entry.py"), "worker", "--version", version],
                env=env, stdout=output, stderr=subprocess.STDOUT,
            )
        wait_for(lambda: f"WORKER_READY {version}" in path.read_text(), "worker startup")

    def stop(self) -> None:
        if self.worker is not None:
            self.worker.kill()
            self.worker.wait(timeout=15)
            self.worker = None


def rejected(operation, description: str) -> None:
    try:
        operation()
    except ValueError:
        return
    raise AssertionError(f"Accepted {description}")


def exercise(processes: Processes) -> dict:
    from coordination.settings import setup, system_url

    setup()
    from django.db import connection, transaction

    from coordination.models import Emission, Intent, Job, Outbox, Question
    from coordination.store import QUEUE, VERSION, WORKFLOW, accept, answer, submit, workflow_id

    messages = transcript()
    request = messages[0]
    first = workflow_id(request)

    def dbos_rows() -> list[dict]:
        with connection.cursor() as cursor:
            cursor.execute("SELECT workflow_uuid, status, application_version, recovery_attempts "
                           "FROM dbos.workflow_status ORDER BY workflow_uuid")
            return [dict(zip(("id", "status", "version", "recoveries"), row, strict=True))
                    for row in cursor.fetchall()]

    def dbos_status(identifier: str, status: str) -> bool:
        return any(row["id"] == identifier and row["status"] == status for row in dbos_rows())

    # A failed enclosing app transaction must retain neither the job nor its outbox intent.
    rollback = copy.deepcopy(request)
    rollback["job_id"] = "rollback-check"
    try:
        with transaction.atomic():
            submit(canonical(rollback))
            raise RuntimeError("injected rollback")
    except RuntimeError:
        pass
    assert not Intent.objects.exists() and not Job.objects.exists() and not Outbox.objects.exists()
    with connection.cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'dbos')")
        assert cursor.fetchone()[0] is False

    # Schema-valid but unimplemented synthetic journeys must not commit stranded app work.
    rejected_before_commit = []
    for index, (template, attempt) in enumerate(((0, "attempt-3"), (0, "attempt-2"), (5, "attempt-1"))):
        unsupported = copy.deepcopy(messages[template])
        unsupported.update(job_id=f"unsupported-{index}", attempt_id=attempt)
        path = processes.state / f"unsupported-{index}.json"
        path.write_bytes(canonical(unsupported))
        result = processes.cli("submit", "--request", str(path), failed=True)
        assert "Unsupported synthetic" in result.stderr
        assert not Intent.objects.exists() and not Job.objects.exists() and not Outbox.objects.exists()
        rejected_before_commit.append({"attempt": attempt, "input_revision": unsupported["input_revision"],
                                       "returncode": result.returncode, "committed_rows": 0})

    # Focused guard injection, NOT runtime durability evidence: a broken emission loop
    # cannot return success even if submission validation had passed. All DB rows roll back.
    from coordination import runtime

    with transaction.atomic():
        guard_request = dict(messages[5], job_id="missing-terminal-guard")
        guard_id = submit(canonical(guard_request))
        with (patch.object(runtime, "DBOS", SimpleNamespace(application_version=VERSION)),
              patch.object(runtime, "synthetic_emissions", return_value=[]),
              patch.object(runtime, "close_old_connections")):  # Preserve the enclosing rollback transaction.
            rejected(lambda: unwrap(runtime.synthetic_runner)(guard_id, Intent.objects.get(pk=guard_id).payload_digest),
                     "runner completion without persisted terminal result")
        assert not Emission.objects.filter(intent_id=guard_id).exists()
        assert Job.objects.get(pk=f"{request['batch_id']}:missing-terminal-guard").state == "queued"
        transaction.set_rollback(True)

    processes.start()
    killed_commit = processes.cli("submit", "--kill-at", "commit-before-enqueue", killed=True)
    assert Intent.objects.count() == Outbox.objects.count() == Job.objects.count() == 1
    assert not Outbox.objects.get(pk=first).acknowledged
    assert dbos_rows() == []
    assert submit(canonical(request)) == first
    changed = copy.deepcopy(request)
    changed["allowed_capabilities"] = ["read_evidence"]
    rejected(lambda: submit(canonical(changed)), "changed payload reuse")
    rejected(lambda: submit(canonical(request), version="incompatible"), "changed version reuse")
    killed_enqueue = processes.cli("dispatch", "--kill-at", "enqueue-before-ack", killed=True)
    assert not Outbox.objects.get(pk=first).acknowledged
    wait_for(lambda: dbos_status(first, "SUCCESS"), "first command completion")
    assert Job.objects.get(pk=f"{request['batch_id']}:{request['job_id']}").state == "waiting_for_user"
    assert Question.objects.filter(intent_id=first, answer__isnull=True).count() == 1
    processes.cli("dispatch")
    assert Outbox.objects.get(pk=first).acknowledged
    assert len(dbos_rows()) == 1 and Emission.objects.filter(intent_id=first).count() == 3
    assert accept(first, canonical(messages[1])) == "duplicate"
    changed_event = copy.deepcopy(messages[1])
    changed_event["code"] = "changed_code"
    rejected(lambda: accept(first, canonical(changed_event)), "conflicting sequence")

    # A second batch on the same serial lane must finish while the first awaits a human.
    second_request = copy.deepcopy(messages[5])
    bundle = processes.state / "bundle"
    second_manifest = decode((bundle / "input-confirmed.json").read_bytes())
    second_manifest["batch_id"] = "batch-second-intake"
    second_bytes = canonical(second_manifest)
    (bundle / "input-second.json").write_bytes(second_bytes)
    second_request["batch_id"] = second_manifest["batch_id"]
    second_request["job_id"] = "second-intake"
    second_request["input_revision"] = sha(second_bytes)
    second_request["input_ref"] = {"path": "input-second.json", "sha256": sha(second_bytes),
                                   "media_type": "application/json"}
    second = submit(canonical(second_request), bundle=bundle)
    processes.cli("dispatch")
    wait_for(lambda: dbos_status(second, "SUCCESS"), "second intake blocked by human wait")
    assert Job.objects.get(pk="batch-second-intake:second-intake").state == "succeeded"
    assert Question.objects.get(intent_id=first).answer is None

    old_reply = copy.deepcopy(messages[4])
    old_reply["question_revision"] = 2
    rejected(lambda: answer(canonical(old_reply), actor="fixture-user"), "stale answer revision")
    rejected(lambda: answer(canonical(messages[4]), actor="other-user"), "unowned answer actor")
    immutable_before = bytes(Intent.objects.get(pk=first).input_bytes)
    continuation = answer(canonical(messages[4]), actor="fixture-user")
    assert continuation != first
    assert bytes(Intent.objects.get(pk=first).input_bytes) == immutable_before
    assert Intent.objects.get(pk=continuation).payload["input_revision"] != request["input_revision"]
    rejected(lambda: answer(canonical(messages[4]), actor="fixture-user"), "obsolete answered attempt")
    rejected(lambda: accept(first, canonical(messages[3])), "obsolete result after edit")
    wrong_context = copy.deepcopy(messages[8])
    wrong_context["input_revision"] = request["input_revision"]
    rejected(lambda: accept(continuation, canonical(wrong_context)), "obsolete input result")
    processes.cli("dispatch")
    wait_for(lambda: dbos_status(continuation, "SUCCESS"), "continuation completion")
    assert Job.objects.get(pk=f"{request['batch_id']}:{request['job_id']}").state == "succeeded"

    # Kill after app result commit but before DBOS step checkpoint; replay must be idempotent.
    processes.stop()
    restarting = copy.deepcopy(messages[5])
    restarting["job_id"] = "worker-restart"
    restart_id = submit(canonical(restarting))
    processes.start(after_result=restart_id)
    processes.cli("dispatch")
    wait_for(lambda: f"RUNNER_RESULT_PAUSED {restart_id}" in processes.logs[-1].read_text(), "result pause")
    assert dbos_status(restart_id, "PENDING")
    assert Emission.objects.filter(intent_id=restart_id).count() == 3
    assert Job.objects.get(pk=f"{request['batch_id']}:worker-restart").state == "succeeded"
    processes.stop()
    processes.start()
    wait_for(lambda: dbos_status(restart_id, "SUCCESS"), "compatible worker recovery")
    assert Emission.objects.filter(intent_id=restart_id).count() == 3

    # Explicitly pinned app versions fence old queued and pending work from incompatible workers.
    processes.stop()
    upgrading = copy.deepcopy(messages[5])
    upgrading["job_id"] = "old-version-queued"
    upgrade_id = submit(canonical(upgrading))
    processes.cli("dispatch")
    processes.start("coordination-v2")
    time.sleep(2)
    assert dbos_status(upgrade_id, "ENQUEUED")
    assert not Emission.objects.filter(intent_id=upgrade_id).exists()
    processes.stop()
    processes.start(pause=upgrade_id)
    wait_for(lambda: f"RUNNER_PAUSED {upgrade_id}" in processes.logs[-1].read_text(), "old worker claim")
    processes.stop()
    processes.start("coordination-v2")
    time.sleep(2)
    assert dbos_status(upgrade_id, "PENDING")
    assert not Emission.objects.filter(intent_id=upgrade_id).exists()
    processes.stop()
    processes.start()
    wait_for(lambda: dbos_status(upgrade_id, "SUCCESS"), "old compatible worker drain")

    # Direct acceptance controls are rolled back so they cannot leave undispatched committed jobs.
    outcomes = decode((HERE.parent / "shared/fixtures/two-lots/outcomes.json").read_bytes())
    accepted_outcomes = []
    for index, outcome in enumerate(outcomes):
        with transaction.atomic():
            terminal_request = copy.deepcopy(request)
            terminal_request["job_id"] = f"terminal-{index}"
            terminal_id = submit(canonical(terminal_request))
            outcome["job_id"] = terminal_request["job_id"]
            assert accept(terminal_id, canonical(outcome)) == "accepted"
            state = Job.objects.get(pk=f"{request['batch_id']}:terminal-{index}").state
            assert state == outcome["status"]
            accepted_outcomes.append(state)
            transaction.set_rollback(True)

    # A result with an intact schema but corrupted proposal bytes cannot update the app.
    with transaction.atomic():
        integrity_request = copy.deepcopy(messages[5])
        integrity_request["job_id"] = "integrity-control"
        integrity_id = submit(canonical(integrity_request))
        for template in messages[6:8]:
            emitted = dict(template, job_id="integrity-control")
            accept(integrity_id, canonical(emitted))
        damaged_bundle = processes.state / "damaged-bundle"
        damaged_bundle.mkdir()
        (damaged_bundle / "expected-stock.json").write_bytes(b"{}")
        emitted = dict(messages[8], job_id="integrity-control")
        rejected(lambda: accept(integrity_id, canonical(emitted), bundle=damaged_bundle), "corrupt output")
        assert Emission.objects.filter(intent_id=integrity_id).count() == 2
        assert Job.objects.get(pk=f"{request['batch_id']}:integrity-control").state == "running"
        transaction.set_rollback(True)
    assert not Outbox.objects.filter(acknowledged=False).exists()

    # Even a direct runtime enqueue cannot run a valid intent under a different workflow ID.
    from dbos import DBOSClient

    client = DBOSClient(system_database_url=system_url())
    try:
        client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                        "workflow_id": "unowned-workflow-control", "app_version": VERSION},
                       continuation, Intent.objects.get(pk=continuation).payload_digest)
        wait_for(lambda: dbos_status("unowned-workflow-control", "ERROR"), "unowned workflow rejection")
        assert Emission.objects.filter(intent_id=continuation).count() == 3
    finally:
        client.destroy()

    # Exact review reproduction: correct workflow ID + intent ID + digest, but v2 metadata.
    # Also reject a conflict before execution and changed digest under the correct version.
    processes.stop()
    runtime_conflicts = []

    def conflicting_dispatch(identifier: str) -> None:
        result = processes.cli("dispatch", failed=True)
        assert f"CONFLICT {identifier} runtime_metadata_conflict" in result.stdout
        row = Outbox.objects.get(pk=identifier)
        assert not row.acknowledged and row.deliveries == 0
        assert row.conflict == "runtime_metadata_conflict"
        assert Job.objects.get(pk=row.intent.job_id).state == "dispatch_conflict"

    client = DBOSClient(system_database_url=system_url())
    try:
        for label, version, changed_digest, dispatch_first in (
            ("wrong-version-after-execution", "coordination-v2", False, False),
            ("wrong-version-before-execution", "coordination-v2", False, True),
            ("wrong-digest-before-execution", VERSION, True, True),
        ):
            adverse_request = copy.deepcopy(messages[5])
            adverse_request["job_id"] = label
            identifier = submit(canonical(adverse_request))
            intent = Intent.objects.get(pk=identifier)
            digest = "0" * 64 if changed_digest else intent.payload_digest
            client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                            "workflow_id": identifier, "app_version": version}, identifier, digest)

            if dispatch_first:
                conflicting_dispatch(identifier)
                assert dbos_status(identifier, "ENQUEUED")
            processes.start(version)
            wait_for(lambda identifier=identifier: dbos_status(identifier, "ERROR"), label)
            log = processes.logs[-1].read_text()
            expected = "Worker payload binding mismatch" if changed_digest else "Executing DBOS application version"
            assert expected in log
            assert Emission.objects.filter(intent_id=identifier).count() == 0
            assert Intent.objects.get(pk=identifier).app_version == VERSION
            if not dispatch_first:
                assert Job.objects.get(pk=intent.job_id).state == "queued"
            conflicting_dispatch(identifier)
            processes.stop()
            # Redelivery/compatible restart cannot silently relabel or reset the bad runtime row.
            processes.start()
            conflicting_dispatch(identifier)
            assert dbos_status(identifier, "ERROR")
            assert client.retrieve_workflow(identifier).get_status().app_version == version
            assert not Emission.objects.filter(intent_id=identifier).exists()
            processes.stop()
            runtime_conflicts.append({"id": identifier, "case": label, "runtime_version": version,
                                      "intent_version": VERSION, "status": "ERROR", "emissions": 0,
                                      "disposition": "runtime_metadata_conflict", "acknowledged": False})
    finally:
        client.destroy()

    # Quarantined conflicts must not stop a later ordinary command on the same lane.
    healthy_request = copy.deepcopy(messages[5])
    healthy_request["job_id"] = "healthy-after-conflicts"
    healthy = submit(canonical(healthy_request))
    processes.start()
    processes.cli("dispatch", failed=True)  # Reports conflicts, but delivers unrelated work.
    wait_for(lambda: dbos_status(healthy, "SUCCESS"), "healthy command after quarantined conflicts")
    assert Job.objects.get(pk=f"{request['batch_id']}:healthy-after-conflicts").state == "succeeded"
    assert Emission.objects.filter(intent_id=healthy).count() == 3
    assert Outbox.objects.filter(acknowledged=True).count() == 6
    assert Outbox.objects.filter(acknowledged=False, conflict="runtime_metadata_conflict").count() == 3
    assert not Outbox.objects.filter(acknowledged=False, conflict="").exists()
    return {
        "result": "passed", "synthetic_provider": True,
        "kill_commit_returncode": killed_commit.returncode,
        "kill_enqueue_returncode": killed_enqueue.returncode,
        "checks": ["migrations_do_not_start_dbos", "app_rollback_atomicity",
                   "commit_before_enqueue_sigkill", "enqueue_before_ack_sigkill",
                   "stable_id_redelivery", "payload_version_conflict", "sequence_conflict",
                   "serial_lane_released_for_second_intake", "immutable_answer_continuation",
                   "stale_answer_result_rejection", "worker_sigkill_after_app_result_before_dbos_checkpoint",
                   "incompatible_queued_and_pending_versions_fenced", "compatible_version_drain",
                   "terminal_outcome_acceptance", "corrupt_output_rejected_without_publication",
                   "actual_dbos_workflow_id_ownership", "unsupported_attempt_input_rejected_before_commit",
                   "local_fault_injected_missing_terminal_guard_rolled_back",
                   "actual_executing_application_version_binding", "persisted_runtime_metadata_conflict",
                   "conflicts_survive_redelivery_and_compatible_restart", "healthy_command_after_conflicts"],
        "rejected_before_commit": rejected_before_commit,
        "runtime_conflicts": runtime_conflicts,
        "rolled_back_terminal_controls": accepted_outcomes,
        "dbos_workflows": dbos_rows(), "jobs": list(Job.objects.values()),
        "intent_count": Intent.objects.count(), "question_count": Question.objects.count(),
        "outbox": list(Outbox.objects.values()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True, help="New private directory; never an existing cluster")
    args = parser.parse_args()
    state = args.state.resolve()
    state.mkdir(mode=0o700, parents=True, exist_ok=False)
    initdb = shutil.which("initdb")
    pg_ctl = shutil.which("pg_ctl")
    if not initdb or not pg_ctl:
        raise RuntimeError("Provide installed PostgreSQL bin directory on PATH; no existing DB fallback")
    shutil.copytree(FIXTURE, state / "bundle")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    env = dict(os.environ, COORDINATION_PG_PORT=str(port),
               COORDINATION_PG_DATABASE="coordination_spike_probe",
               COORDINATION_BUNDLE=str(state / "bundle"))
    # Do not consume application/provider credentials or user libpq routing settings.
    for key in list(env):
        if key.startswith(("PG", "DBOS_")) or key == "DATABASE_URL":
            del env[key]
    os.environ.update({k: env[k] for k in ("COORDINATION_PG_PORT", "COORDINATION_PG_DATABASE")})
    processes = Processes(state, env)
    cluster = state / "pg"
    with (state / "initdb.log").open("w", encoding="utf-8") as output:
        subprocess.run([initdb, "-D", str(cluster), "--username=coordination_spike",
                        "--auth=trust", "--no-locale", "--encoding=UTF8"],
                       env=env, stdout=output, stderr=subprocess.STDOUT, check=True, timeout=30)
    try:
        subprocess.run([pg_ctl, "-D", str(cluster), "-l", str(state / "postgres.log"),
                        "-o", f"-h 127.0.0.1 -p {port} -k ''", "-w", "start"],
                       env=env, check=True, timeout=30)
        import psycopg

        with psycopg.connect(host="127.0.0.1", port=port, user="coordination_spike",
                             dbname="postgres", autocommit=True) as db:
            db.execute("CREATE DATABASE coordination_spike_probe")
        processes.cli("migrate")
        report = exercise(processes)
        import importlib.metadata

        report["versions"] = {name: importlib.metadata.version(name) for name in
                              ("dbos", "django", "psycopg", "sqlalchemy")}
        report["observed_at_utc"] = datetime.now(timezone.utc).isoformat()
        report["python"] = sys.version.split()[0]
        report["postgres"] = subprocess.check_output([initdb, "--version"], text=True).strip()
        (state / "evidence.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
    finally:
        processes.stop()
        if (cluster / "postmaster.pid").exists():
            subprocess.run([pg_ctl, "-D", str(cluster), "-m", "fast", "-w", "stop"],
                           env=env, check=True, timeout=30)


if __name__ == "__main__":
    main()

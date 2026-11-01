"""DBOS execution is imported only by the explicit worker CLI."""

import os
import time

from dbos import DBOS, Queue
from django.db import close_old_connections

from .boundary import canonical, request_input, sha, synthetic_emissions
from .models import Emission, Intent
from .settings import bundle_path
from .store import QUEUE, WORKFLOW, accept, payload_digest


@DBOS.step(name="synthetic_runner_v1")
def synthetic_runner(identifier: str, digest: str) -> str:
    close_old_connections()
    intent = Intent.objects.get(pk=identifier)
    if DBOS.application_version != intent.app_version:
        raise ValueError("Executing DBOS application version does not own the intent")
    if digest != intent.payload_digest or digest != payload_digest(intent.payload, intent.app_version):
        raise ValueError("Worker payload binding mismatch")
    bundle = bundle_path()
    raw = request_input(intent.payload, bundle)
    if raw != bytes(intent.input_bytes) or sha(raw) != intent.payload["input_revision"]:
        raise ValueError("Stored immutable input mismatch")
    # Process-kill probe pauses outside any application transaction. It is not provider behavior.
    if os.environ.get("COORDINATION_PAUSE_WORKFLOW") == identifier:
        print(f"RUNNER_PAUSED {identifier}", flush=True)
        time.sleep(120)
    for emitted in synthetic_emissions(intent.payload, raw):
        emitted.update({k: intent.payload[k] for k in (
            "batch_id", "job_id", "attempt_id", "input_revision",
        )})
        accept(identifier, canonical(emitted), bundle=bundle)
    if not Emission.objects.filter(intent=intent, payload__type="job.result").exists():
        raise ValueError("Synthetic runner finished without a persisted terminal result")
    if os.environ.get("COORDINATION_PAUSE_AFTER_RESULT") == identifier:
        print(f"RUNNER_RESULT_PAUSED {identifier}", flush=True)
        time.sleep(120)
    close_old_connections()
    return "synthetic-command-finished"


@DBOS.workflow(name=WORKFLOW, max_recovery_attempts=5)
def command(identifier: str, digest: str) -> str:
    if DBOS.workflow_id != identifier:
        raise ValueError("DBOS workflow does not own the application intent")
    # Check outside the step too: a recovered/cached step must not bypass version ownership.
    close_old_connections()
    if DBOS.application_version != Intent.objects.get(pk=identifier).app_version:
        raise ValueError("Executing DBOS application version does not own the intent")
    return synthetic_runner(identifier, digest)


def run_worker(url: str, version: str) -> None:
    DBOS(config={
        "name": "intake-coordination-spike", "system_database_url": url,
        "application_version": version, "executor_id": "coordination-single-worker",
        "run_admin_server": False, "enable_otlp": False,
    })
    Queue(QUEUE, concurrency=1, worker_concurrency=1, polling_interval_sec=0.1)
    DBOS.launch()
    print(f"WORKER_READY {version}", flush=True)
    try:
        while True:
            time.sleep(1)
    finally:
        DBOS.destroy()

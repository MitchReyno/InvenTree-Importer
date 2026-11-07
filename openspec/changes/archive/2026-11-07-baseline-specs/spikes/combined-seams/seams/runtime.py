"""Explicit real DBOS worker; provider actions below are observation replay only."""

import os
from pathlib import Path
import subprocess
import sys
import time

from dbos import DBOS, Queue
from django.db import close_old_connections

from adapter import load_intent, read_json
from coordination.boundary import canonical
from coordination.models import Intent
from coordination.store import accept, payload_digest
from invimport.demo.runner import child_environment
from invimport.demo.workspace import load_workspace, save_json
from supervisor import Child, snapshot

from .bootstrap import system_url
from .models import Approval
from .observations import emissions, validate_input
from .store import QUEUE, VERSION, WORKFLOW, bound_approval, publish, validate_result


def export_approval(row: Approval) -> Path:
    path = Path(row.workspace)
    destination = path / "intents" / (row.pk + ".json")
    if destination.exists() and read_json(destination) != row.payload:
        raise ValueError("adapter transport conflicts with PostgreSQL approval")
    save_json(destination, row.payload)
    load_intent(path, row.pk)  # Existing public complete approval/target/build validator.
    return path


def reservation_death(path: Path, identifier: str) -> None:
    _path, manifest = load_workspace(path)
    environment = child_environment(path, manifest)
    root = Path(__file__).resolve().parents[1]
    environment["PYTHONPATH"] += os.pathsep + str(root.parent / "importer-adapter")
    result = subprocess.run([sys.executable, str(root / "reservation_fault.py"), str(path), identifier],
                            env=environment, capture_output=True, timeout=30)
    if result.returncode != -9:
        raise RuntimeError("reservation fault did not SIGKILL the actual child")
    print(f"RESERVATION_CHILD_KILLED {identifier} -9", flush=True)


@DBOS.step(name="combined_effect_boundary_v1")
def perform(kind: str, identifier: str, digest: str) -> str:
    close_old_connections()
    if kind == "control":
        return "authored-serial-lane-control"
    if kind == "research":
        row = Intent.objects.get(pk=identifier)
        if row.app_version != DBOS.application_version or row.payload_digest != digest:
            raise ValueError("research runtime owner conflict")
        if digest != payload_digest(row.payload, row.app_version):
            raise ValueError("research payload conflict")
        bundle = Path(os.environ["COMBINED_BUNDLE"])
        if validate_input(row.payload, bundle) != bytes(row.input_bytes):
            raise ValueError("immutable input conflict")
        for emitted in emissions(row.attempt_id):
            if emitted.get("status") == "succeeded":
                report = validate_result(bundle, emitted)
                save_json(bundle / "validation.json", report)
            accept(identifier, canonical(emitted), bundle=bundle)
        return "retained-provider-observation-replayed"
    if kind != "apply":
        raise ValueError("unknown command kind")
    row = bound_approval(identifier, digest)
    if row.version != DBOS.application_version:
        raise ValueError("apply runtime version conflict")
    path = export_approval(row)
    if os.environ.get("COMBINED_RESERVATION_DEATH") == identifier:
        reservation_death(path, identifier)
    try:
        # A completed child result is NOT product success: canonical operations decide it.
        result = Child(path, identifier).wait()
    except RuntimeError:
        publish(identifier, None, "recovery_required")
        return "recovery-required-no-new-namespace"
    marker = path / "engine-result-before-publication.json"
    if os.environ.get("COMBINED_PAUSE_RESULT") == identifier and not marker.exists():
        save_json(marker, result)
        print(f"ENGINE_RESULT_UNPUBLISHED {identifier} {result['run_id']}", flush=True)
        time.sleep(120)
    canonical_snapshot = snapshot(path, identifier)
    publish(identifier, canonical_snapshot, "canonical_snapshot")
    return result["run_id"]


@DBOS.workflow(name=WORKFLOW, max_recovery_attempts=5)
def command(kind: str, identifier: str, digest: str) -> str:
    if DBOS.workflow_id != identifier:
        raise ValueError("unowned actual workflow ID")
    close_old_connections()
    version = (Intent.objects.get(pk=identifier).app_version if kind == "research"
               else bound_approval(identifier, digest).version if kind == "apply" else VERSION)
    if version != DBOS.application_version:
        raise ValueError("actual execution version conflict")
    return perform(kind, identifier, digest)


def worker() -> None:
    DBOS(config={"name": "combined-seams", "system_database_url": system_url(),
                 "application_version": VERSION, "executor_id": "combined-owned-worker",
                 "run_admin_server": False, "enable_otlp": False})
    Queue(QUEUE, concurrency=1, worker_concurrency=1, polling_interval_sec=0.1)
    DBOS.launch()
    print("WORKER_READY", flush=True)
    try:
        while True:
            time.sleep(1)
    finally:
        DBOS.destroy()

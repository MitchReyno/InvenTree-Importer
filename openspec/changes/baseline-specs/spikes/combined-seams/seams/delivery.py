"""Outbox delivery only: DBOS owns the serial execution lane."""

import os
import signal

from dbos import DBOSClient
from django.db import transaction

from coordination.models import Intent, Outbox
from coordination.store import payload_digest

from .bootstrap import system_url
from .models import ApplyOutbox
from .store import QUEUE, WORKFLOW, bound_approval


def dispatch(*, kill_after_enqueue: bool = False) -> list[str]:
    conflicts = []
    client = DBOSClient(system_database_url=system_url())
    try:
        for model, kind in ((Outbox, "research"), (ApplyOutbox, "apply")):
            for identifier in list(model.objects.filter(acknowledged=False).values_list("pk", flat=True)):
                with transaction.atomic():
                    row = model.objects.select_for_update().get(pk=identifier)
                    if row.acknowledged:
                        continue
                    if row.conflict:
                        conflicts.append(identifier)
                        continue
                    if kind == "research":
                        command = Intent.objects.get(pk=identifier)
                        digest, version = command.payload_digest, command.app_version
                        if digest != payload_digest(command.payload, version):
                            raise ValueError("corrupt research intent")
                    else:
                        command = row.approval
                        digest, version = command.command_digest, command.version
                        bound_approval(identifier, digest)
                    arguments = (kind, identifier, digest)
                    handle = client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                                             "workflow_id": identifier, "app_version": version}, *arguments)
                    status = handle.get_status()
                    inputs = status.input or {}
                    if (status.app_version != version or status.name != WORKFLOW or status.queue_name != QUEUE
                            or status.class_name is not None or status.config_name is not None
                            or tuple(inputs.get("args", ())) != arguments or inputs.get("kwargs") != {}):
                        row.conflict = "runtime_metadata_conflict"
                        row.save(update_fields=["conflict"])
                        conflicts.append(identifier)
                        continue
                    print(f"ENQUEUED {kind} {identifier}", flush=True)
                    if kill_after_enqueue:
                        os.kill(os.getpid(), signal.SIGKILL)
                    row.acknowledged = True
                    row.save(update_fields=["acknowledged"])
    finally:
        client.destroy()
    return conflicts

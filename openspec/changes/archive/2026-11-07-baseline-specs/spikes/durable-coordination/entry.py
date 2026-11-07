"""Run from the checkout; no web server, inventory credentials or provider runtime."""

import argparse
import json
import os
import signal
from pathlib import Path

from coordination.boundary import canonical, transcript


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["migrate", "worker", "submit", "dispatch", "answer", "status"])
    parser.add_argument("--request", type=Path)
    parser.add_argument("--version", default="coordination-v1")
    parser.add_argument("--kill-at", choices=["commit-before-enqueue", "enqueue-before-ack"])
    args = parser.parse_args()
    from coordination.settings import bundle_path, setup, system_url

    setup()
    from coordination.models import Intent, Job, Outbox
    from coordination.store import QUEUE, WORKFLOW, answer, payload_digest, submit

    if args.command == "migrate":
        from django.core.management import call_command

        call_command("migrate", verbosity=1)
    elif args.command == "worker":
        from coordination.runtime import run_worker

        run_worker(system_url(), args.version)
    elif args.command == "submit":
        raw = args.request.read_bytes() if args.request else canonical(transcript()[0])
        print(submit(raw, version=args.version, bundle=bundle_path()), flush=True)
        if args.kill_at == "commit-before-enqueue":
            os.kill(os.getpid(), signal.SIGKILL)
    elif args.command == "answer":
        print(answer(canonical(transcript()[4]), actor="fixture-user"), flush=True)
    elif args.command == "dispatch":
        from dbos import DBOSClient
        from django.db import transaction

        client = DBOSClient(system_database_url=system_url())
        conflicts = []
        try:
            # Delivery only, not an independent lease scheduler. Concurrent dispatchers serialize
            # outbox rows; a killed delivery rolls back its ACK and repeats the same workflow ID.
            for identifier in list(Outbox.objects.filter(acknowledged=False).values_list("pk", flat=True)):
                with transaction.atomic():
                    row = Outbox.objects.select_for_update().get(pk=identifier)
                    if row.acknowledged:
                        continue
                    if row.conflict:
                        conflicts.append(identifier)
                        print(f"CONFLICT {identifier} {row.conflict}", flush=True)
                        continue
                    intent = Intent.objects.get(pk=identifier)
                    if intent.payload_digest != payload_digest(intent.payload, intent.app_version):
                        raise ValueError("Corrupted outbox payload")
                    handle = client.enqueue({"workflow_name": WORKFLOW, "queue_name": QUEUE,
                                             "workflow_id": identifier, "app_version": intent.app_version},
                                            identifier, intent.payload_digest)
                    # Enqueue may adopt a preexisting ID without comparing arguments/version.
                    # Inspect the committed row AFTER enqueue, including a concurrent first writer.
                    status = handle.get_status()
                    inputs = status.input or {}
                    if (status.app_version != intent.app_version or status.name != WORKFLOW
                            or status.queue_name != QUEUE or status.class_name is not None
                            or status.config_name is not None
                            or tuple(inputs.get("args", ())) != (identifier, intent.payload_digest)
                            or inputs.get("kwargs") != {}):
                        row.conflict = "runtime_metadata_conflict"
                        row.save(update_fields=["conflict"])
                        job = Job.objects.select_for_update().get(pk=intent.job_id)
                        if job.current_attempt == identifier:
                            job.state = "dispatch_conflict"
                            job.save(update_fields=["state"])
                        conflicts.append(identifier)
                        print(f"CONFLICT {identifier} {row.conflict}", flush=True)
                        continue
                    print(f"ENQUEUED {identifier}", flush=True)
                    if args.kill_at == "enqueue-before-ack":
                        os.kill(os.getpid(), signal.SIGKILL)
                    row.acknowledged = True
                    row.deliveries += 1
                    row.save()
        finally:
            client.destroy()
        if conflicts:
            raise SystemExit("Dispatch conflicts require explicit review; no ACK or runtime rebinding")
    else:
        print(json.dumps({"jobs": list(Job.objects.values()),
                          "outbox": list(Outbox.objects.values())}, sort_keys=True))


if __name__ == "__main__":
    main()

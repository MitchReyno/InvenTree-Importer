"""Command process boundary, intentionally not an HTTP/session/auth server."""

import argparse
import os
from pathlib import Path
import signal

from seams.bootstrap import setup


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["migrate", "worker", "submit", "answer", "approve", "dispatch", "reconcile"])
    parser.add_argument("--file", type=Path)
    parser.add_argument("--principal", default="unauthorized")
    parser.add_argument("--kill-at", choices=["approval-commit", "enqueue-before-ack"])
    parser.add_argument("--key")
    args = parser.parse_args()
    setup()
    from coordination.boundary import decode
    from invimport.execution.models import Plan
    from seams import store

    bundle = Path(os.environ["COMBINED_BUNDLE"])
    if args.command == "migrate":
        from django.core.management import call_command
        call_command("migrate", verbosity=0)
    elif args.command == "worker":
        from seams.runtime import worker
        worker()
    elif args.command == "submit":
        print(store.submit(decode(args.file.read_bytes()), bundle), flush=True)
    elif args.command == "answer":
        print(store.answer(decode(args.file.read_bytes()), bundle, principal=args.principal), flush=True)
    elif args.command == "approve":
        record = decode(args.file.read_bytes())
        print(store.approve(record["research"], Path(record["workspace"]), Plan.loads(record["plan"]),
                            record["binding"], principal=args.principal), flush=True)
        if args.kill_at == "approval-commit":
            os.kill(os.getpid(), signal.SIGKILL)
    elif args.command == "dispatch":
        from seams.delivery import dispatch
        if dispatch(kill_after_enqueue=args.kill_at == "enqueue-before-ack"):
            raise SystemExit("retained runtime conflict; no ACK or rebinding")
    else:
        from seams.models import Approval
        from supervisor import snapshot
        row = Approval.objects.get(pk=args.key)
        store.bound_approval(row.pk, row.command_digest)
        store.publish(row.pk, snapshot(Path(row.workspace), row.pk), "canonical_snapshot")


if __name__ == "__main__":
    main()

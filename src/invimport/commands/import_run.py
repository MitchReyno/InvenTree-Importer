"""Opt-in durable stock imports. Prepare and review before explicit --write.

Status is local. Resume/retry require reviewed database continuity acknowledgement
when no immutable identity is available. Abandon preserves a blocking tombstone.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from ..config import load_categories_config, load_parameters_config
from ..execution.executor import ContinuityReview
from ..execution.models import Plan, Target
from ..execution.observation import Event, Observation, observing, operation
from ..execution.ownership import normalize_endpoint, state_root
from ..execution.run_control import (InvocationFailure, abandon_run, complete, inspect_run,
                                     preview, record_continuity, saved_run)
from ..execution.stock_preparation import PreparationReview
from ..execution.stock_workflow import execute_stock, prepare_full_stock, repair_stock, resume_stock
from ..inventree.api import connect
from ..inventree.stockimport import ImportOptions
from ..stockfile import read_file
from ..validate import validate

NAME = "import-run"
HELP = "prepare, execute and recover an opt-in durable stock import"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    commands = parser.add_subparsers(dest="action", required=True)
    for name in ("prepare", "execute", "status", "resume", "retry-operation", "abandon"):
        sub = commands.add_parser(name)
        sub.add_argument("--json", action="store_true", help="emit one JSON result on stdout")
        sub.add_argument("--events", type=Path, help="write redacted sequenced invocation JSONL")
        if name == "prepare":
            sub.add_argument("file", type=Path)
            sub.add_argument("--output", type=Path, required=True)
            sub.add_argument("--config", type=Path)
            sub.add_argument("--location", default="")
            sub.add_argument("--on-partial", choices=("skip", "new"), default="skip")
            sub.add_argument("--no-orders", action="store_true")
            sub.add_argument("--no-archive", action="store_true")
            sub.add_argument("--no-provenance", action="store_true")
            sub.add_argument("--mirror-datasheets", action="store_true")
            sub.add_argument("--no-manufacturers", action="store_true")
            sub.add_argument("--no-suppliers", action="store_true")
            sub.add_argument("--no-locations", action="store_true")
            sub.add_argument("--min-confidence", type=float, default=0.0)
        elif name == "execute":
            sub.add_argument("plan", type=Path)
            sub.add_argument("--run-directory", type=Path)
        else:
            sub.add_argument("run_id")
        if name == "retry-operation":
            sub.add_argument("operation_id")
        if name in {"resume", "retry-operation"}:
            sub.add_argument("--continuity-reason", help="reviewed same database continuity acknowledgement; cannot override identity drift")
        if name == "abandon":
            sub.add_argument("--reason", required=True, help="audit reason; unresolved ownership remains blocked")
        if name not in {"prepare", "status"}:
            sub.add_argument("--write", action="store_true", help="explicitly authorize this operation")
        sub.add_argument("--yes", action="store_true", help="accept already explicit choices; never implies --write or continuity")


def _atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            temporary.chmod(0o600)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _outline(action: str) -> None:
    print(f"{action}: validate local input → connect/setup/auth if needed → complete discovery/downloads if preparing → review frozen hierarchy → guarded domain operations if --write → retained artifacts/report", file=sys.stderr)


def _hierarchy(plan: Plan) -> None:
    print(f"Resolved plan {plan.revision} for {plan.target.endpoint}", file=sys.stderr)
    for row in preview(plan)["operations"]:
        print(f"  {row['group']}: {row['action']} [{row['id']}] lines={','.join(row['lines'])}", file=sys.stderr)


def _current(plan: Plan | None = None) -> Target:
    endpoint = normalize_endpoint(os.environ.get("INVENTREE_URL", ""))
    if plan is not None and endpoint != normalize_endpoint(plan.target.endpoint):
        raise ValueError("configured target differs from approved plan")
    # The SDK's mutable server_details does not establish immutable DB identity.
    return Target(endpoint)


def _prepare(args: argparse.Namespace) -> dict:
    if not 0 <= args.min_confidence <= 1:
        raise ValueError("min-confidence must be between 0 and 1")
    categories = load_categories_config(args.config)
    parameters = load_parameters_config(args.config)
    document = read_file(args.file)
    report = validate(document, categories, parameters)
    if not report.ok:
        raise ValueError("stock input validation failed; use import-stock --validate")
    target = _current()
    with operation("connection", group="connection"):
        api = connect()
    options = ImportOptions(default_location=args.location, on_partial=args.on_partial,
                            create_orders=not args.no_orders, archive=not args.no_archive,
                            provenance=not args.no_provenance, mirror_datasheets=args.mirror_datasheets,
                            create_manufacturers=not args.no_manufacturers,
                            create_suppliers=not args.no_suppliers,
                            create_locations=not args.no_locations, min_confidence=args.min_confidence)
    with operation("prepare full stock", group="preparation"):
        plan = prepare_full_stock(document, categories=categories, parameters=parameters,
                                  target=target, api=api, options=options,
                                  generated_paths=tuple(path for path in (args.output, args.events) if path))
    _hierarchy(plan)
    _atomic(args.output, plan.dumps() + "\n")
    return {**preview(plan), "prepared": True, "output": str(args.output)}


def _perform(args: argparse.Namespace, observation: Observation) -> tuple[dict, int]:
    if args.action == "prepare":
        return _prepare(args), 0
    if args.action == "status":
        result = inspect_run(args.run_id)
        return result, 0 if result["complete"] else 1
    if args.action == "execute":
        plan = Plan.loads(args.plan.read_text(encoding="utf-8"))
        path = None
    else:
        plan, path = saved_run(args.run_id)
    _hierarchy(plan)
    if not args.write:
        return {**preview(plan), "preview_only": True}, 0
    if args.action == "abandon":
        result = abandon_run(args.run_id, reason=args.reason)
        return result, 0 if result["complete"] else 1
    current = _current(plan)
    continuity = None
    if args.action in {"resume", "retry-operation"}:
        if not args.continuity_reason or not args.continuity_reason.strip():
            print("Resume/retry requires --continuity-reason: reviewed same-database continuity; --yes does not certify this.", file=sys.stderr)
            raise ValueError("--continuity-reason is required for reviewed same-database continuity")
        record_continuity(args.run_id, plan, reason=args.continuity_reason)
        continuity = ContinuityReview(plan.revision, current.endpoint,
                                      sha256(args.continuity_reason.encode()).hexdigest())
    with operation("connection", group="connection"):
        api = connect()
    with operation(args.action, group="execution"):
        if args.action == "execute":
            directory = args.run_directory or state_root() / "execution" / "runs" / uuid4().hex
            result = execute_stock(plan, api=api, current_target=current, run_directory=directory,
                                   cancelled=observation.cancelled)
        elif args.action == "resume":
            result = resume_stock(plan, args.run_id, path, api=api, current_target=current,
                                  continuity=continuity, cancelled=observation.cancelled)
        else:
            result = repair_stock(plan, args.run_id, path, args.operation_id, api=api,
                                  current_target=current, continuity=continuity,
                                  cancelled=observation.cancelled)
    if observation.cancelled.is_set():
        return result, 130
    return result, 0 if complete(result) else 1


def run(args: argparse.Namespace) -> int:
    _outline(args.action)
    inputs = [getattr(args, name, None) for name in ("file", "plan")]
    outputs = [getattr(args, name, None) for name in ("output", "events")]
    if (len({path.resolve() for path in outputs if path}) != len([path for path in outputs if path])
            or any(path.resolve() == source.resolve() for path in outputs if path for source in inputs if source)
            or any(path.name in {"registry.sqlite3", "run.sqlite3", "registry.initialized", ".invimport-run"}
                   for path in outputs if path)):
        if args.json:
            print(json.dumps({"format": "invimport-run-error/1", "error": "unsafe_output_destination"}))
        print("ERROR: generated outputs must not replace input or execution authority", file=sys.stderr)
        return 1

    def render(event: Event) -> None:
        print(f"[{event.sequence}] {event.kind}: {event.label} {event.outcome}"
              + (f" run={event.context.run}" if event.kind == "run_started" else ""), file=sys.stderr, flush=True)

    observation = Observation(render)
    code = 1
    result: dict = {}
    failure: Exception | None = None
    with observing(observation):
        try:
            result, code = _perform(args, observation)
        except (KeyboardInterrupt, InterruptedError):
            observation.cancelled.set()
            result, code = {"format": "invimport-run-error/1", "error": "cancelled"}, 130
        except Exception as exc:
            # SDK exceptions can embed auth headers, tokens and response bodies.
            # Preserve the cause without exposing its free-form arguments.
            failure = exc
            result = {"format": "invimport-run-error/1", "error": type(exc).__name__,
                      "message": "operation stopped; inspect local status and configuration"}
            if isinstance(exc, PreparationReview):
                # These messages are composed by domain validation, never from
                # raw SDK exceptions/responses. Inventory identifiers are useful
                # to the operator; events still contain no free-form error text.
                result["message"] = str(exc)
            print(f"ERROR: {type(exc).__name__}; {result['message']}", file=sys.stderr)
        finally:
            if args.events:
                try:
                    _atomic(args.events, "".join(json.dumps({"format": "invimport-observation/1", "stream": observation.run, **asdict(event)}) + "\n" for event in observation.snapshot()))
                except OSError:
                    result = {**result, "events_saved": False}
                    code = 1
    started = next((event for event in observation.snapshot() if event.kind == "run_started"), None)
    if started is not None:
        result.setdefault("run_id", started.context.run)
    elif hasattr(args, "run_id"):
        result.setdefault("run_id", args.run_id)
    if args.json:
        print(json.dumps(result))
    else:
        print(json.dumps(result, indent=2))
    if failure is not None:
        raise InvocationFailure("durable import stopped; inspect local status") from failure
    return code

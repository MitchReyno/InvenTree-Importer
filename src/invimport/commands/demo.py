"""Run synthetic imports against an owned persistent loopback HTTP stub.

Start a foreground server in a NEW workspace, then use run in another terminal.
All data and credentials are fictional. This command ignores real .env settings.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shlex
import sqlite3
import subprocess
import sys

from ..execution.ownership import JournalError
from ..demo.runner import run_import
from ..demo.server import DemoHTTPServer
from ..demo.state import DemoState
from ..demo.workspace import MARKER, create_workspace, load_workspace, save_json

NAME = "demo"
HELP = "demonstrate real import-run CLI against private fake loopback inventory"


def delay_milliseconds(value: str) -> int:
    try:
        delay = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("delay-ms must be an integer from 0 to 1000") from exc
    if not 0 <= delay <= 1000:
        raise argparse.ArgumentTypeError("delay-ms must be an integer from 0 to 1000")
    return delay


def add_arguments(parser: argparse.ArgumentParser) -> None:
    commands = parser.add_subparsers(dest="demo_action", required=True)
    serve = commands.add_parser("serve", help="foreground loopback server; Ctrl-C stops, state remains")
    serve.add_argument("--workspace", type=Path, required=True)
    serve.add_argument("--scenario", choices=("happy", "partial"), help="required for NEW workspace; never resets existing state")
    serve.add_argument("--delay-ms", type=delay_milliseconds, default=0,
                       help="delay each API/media request before effects (0-1000 ms; default: 0; try 250)")
    serve.add_argument("--restart", action="store_true", help="restart an existing positively owned workspace on its original port")
    run = commands.add_parser("run", help="invoke real import-run in a strictly isolated subprocess")
    run.add_argument("workspace", type=Path)
    run.add_argument("action", choices=("prepare", "execute", "status", "resume", "retry-operation"))
    run.add_argument("operation_id", nargs="?")
    run.add_argument("--write", action="store_true")
    run.add_argument("--continuity-reason")
    inspect = commands.add_parser("inspect", help="read fake counts/PKs/bytes/faults/requests locally")
    inspect.add_argument("workspace", type=Path)


def serve_workspace(args: argparse.Namespace) -> int:
    if args.restart:
        path, manifest = load_workspace(args.workspace)
        if args.scenario and args.scenario != manifest["scenario"]:
            raise ValueError("restart cannot change the original scenario")
        if manifest["port"] == 0:
            raise ValueError("incomplete initial startup; retain workspace for inspection and choose a new one")
    else:
        if args.scenario is None:
            raise ValueError("new demo requires --scenario happy or partial")
        path, manifest = create_workspace(args.workspace, args.scenario)
    with DemoHTTPServer(DemoState(path / "server.sqlite3"), manifest["instance"], manifest["port"], delay_ms=args.delay_ms) as server:
        manifest["port"] = server.server_port
        save_json(path / MARKER, manifest)
        print(json.dumps({"demo": True, "ready": True, "workspace": str(path), "scenario": manifest["scenario"],
                          "target": f"http://127.0.0.1:{server.server_port}/", "instance": manifest["instance"], "delay_ms": server.delay_ms}), flush=True)
        print(f"DEMO ONLY — synthetic inventory. Source/config/output/fake DB/registry: {path}", file=sys.stderr, flush=True)
        print(f"DEMO request pacing: {server.delay_ms} ms before each API/media request", file=sys.stderr, flush=True)
        quoted = shlex.quote(str(path))
        print(f"In another terminal: uv run invimport demo run {quoted} prepare\n"
              f"Then review plan; uv run invimport demo run {quoted} execute --write\n"
              "Ctrl-C stops this foreground server; keep workspace unchanged for recovery/restart.", file=sys.stderr, flush=True)
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            print("DEMO server stopped; fake database and recovery state retained.", file=sys.stderr, flush=True)
    return 0


def run(args: argparse.Namespace) -> int:
    try:
        if args.demo_action == "serve":
            return serve_workspace(args)
        if args.demo_action == "inspect":
            path, manifest = load_workspace(args.workspace)
            print(json.dumps({"workspace": str(path), "instance": manifest["instance"],
                              **DemoState(path / "server.sqlite3").inspect()}, indent=2))
            return 0
        if args.operation_id and args.action != "retry-operation":
            raise ValueError("operation ID is valid only with retry-operation")
        if args.write and args.action in {"prepare", "status"}:
            raise ValueError("prepare/status do not accept --write")
        if args.continuity_reason is not None and args.action not in {"resume", "retry-operation"}:
            raise ValueError("continuity reason is valid only for resume/retry-operation")
        return run_import(args.workspace, args.action, operation_id=args.operation_id,
                          write=args.write, continuity_reason=args.continuity_reason)
    except (OSError, ValueError, KeyError, sqlite3.DatabaseError, subprocess.SubprocessError, JournalError) as exc:
        print(f"DEMO error: {exc}", file=sys.stderr)
        return 1

"""Launch the real CLI with an explicit private target and isolated environment."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
from email.message import Message
from typing import BinaryIO
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .server import TOKEN
from .workspace import load_workspace, save_json


def endpoint(manifest: dict) -> str:
    port = manifest["port"]
    if port == 0:
        raise ValueError("demo server has not bound its persistent port")
    return f"http://127.0.0.1:{port}/"


class RefuseRedirects(HTTPRedirectHandler):
    def redirect_request(self, request: Request, file_pointer: BinaryIO, code: int,
                         message: str, headers: Message, new_url: str) -> None:
        raise ValueError("demo identity redirects are forbidden")


def verify_server(manifest: dict) -> None:
    # Explicit empty proxy configuration prevents inherited proxy redirects.
    opener = build_opener(ProxyHandler({}), RefuseRedirects())
    with opener.open(endpoint(manifest) + "demo/identity", timeout=3) as response:
        identity = json.load(response)
        if response.url != endpoint(manifest) + "demo/identity":
            raise ValueError("demo identity redirected")
    if identity != {"demo": True, "instance": manifest["instance"]}:
        raise ValueError("loopback port does not belong to this demo database")


def child_environment(path: Path, manifest: dict) -> dict[str, str]:
    # Allow only interpreter/OS settings, never inherited service credentials,
    # proxies, target/state/config settings or the user's home/cache location.
    allowed = {"PATH", "LANG", "LC_ALL", "LC_CTYPE", "SYSTEMROOT", "WINDIR", "VIRTUAL_ENV"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    environment.update(PYTHONPATH=str(Path(__file__).resolve().parents[2]), HOME=str(path / "home"), USERPROFILE=str(path / "home"),
                       XDG_CACHE_HOME=str(path / "home" / "cache"), PYTHONNOUSERSITE="1",
                       INVENTREE_URL=endpoint(manifest), INVENTREE_TOKEN=TOKEN,
                       INVIMPORT_STATE_DIR=str(path / "state"), NO_PROXY="127.0.0.1", no_proxy="127.0.0.1")
    return environment


def run_import(path: Path, action: str, *, operation_id: str | None = None,
               write: bool = False, continuity_reason: str | None = None) -> int:
    path, manifest = load_workspace(path)
    if action == "execute" and write and ((path / "output" / "run.json").exists()
            or (path / "state" / "execution" / "registry.sqlite3").exists()):
        raise ValueError("demo workspace already has execution history; use status/resume/retry-operation or a new workspace")
    if action == "prepare":
        arguments = ["prepare", str(path / "source" / "stock.json"), "--config", str(path / "config"),
                     "--output", str(path / "output" / "plan.json")]
    elif action == "execute":
        arguments = ["execute", str(path / "output" / "plan.json")]
    else:
        run_id = json.loads((path / "output" / "run.json").read_text(encoding="utf-8"))["run_id"]
        if not isinstance(run_id, str) or not run_id:
            raise ValueError("missing demo run ID; retained registry remains authority")
        arguments = [action, run_id]
        if action == "retry-operation":
            if not operation_id:
                raise ValueError("retry-operation requires an explicit original operation ID from status")
            arguments.append(operation_id)
    if write:
        arguments.append("--write")
    if continuity_reason is not None:
        arguments += ["--continuity-reason", continuity_reason]
    arguments += ["--json", "--events", str(path / "output" / f"{action}-events.jsonl")]
    # Preview execute/recovery and status remain connection-free like import-run.
    if action == "prepare" or (write and action != "status"):
        verify_server(manifest)
    command = [sys.executable, "-P", "-m", "invimport", "--env-file", str(path / "demo.env"), "import-run", *arguments]
    print("DEMO ONLY: " + shlex.join(command), file=sys.stderr, flush=True)
    print(f"DEMO target={endpoint(manifest)} source/config={path} registry={path / 'state'}", file=sys.stderr, flush=True)
    result = subprocess.run(command, env=child_environment(path, manifest), cwd=path, text=True,
                            stdout=subprocess.PIPE, check=False, timeout=300)
    # SDK hierarchy/progress is inherited stderr. Stdout remains one real CLI result.
    sys.stdout.write(result.stdout)
    sys.stdout.flush()
    try:
        snapshot = json.loads(result.stdout)
    except ValueError:
        return result.returncode
    save_json(path / "output" / f"{action}-result.json", snapshot)
    if action == "execute" and isinstance(snapshot.get("run_id"), str):
        run_record = path / "output" / "run.json"
        if run_record.exists() and json.loads(run_record.read_text(encoding="utf-8"))["run_id"] != snapshot["run_id"]:
            raise ValueError("demo run locator changed; inspect registry rather than replacing history")
        save_json(run_record, {"run_id": snapshot["run_id"]})
    return result.returncode

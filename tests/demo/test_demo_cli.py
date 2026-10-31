"""Real CLI subprocesses, SDK HTTP and persistent demo recovery; no monkeypatch API."""
from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

import pytest

from invimport.__main__ import cli
from invimport.demo.server import DemoHTTPServer
from invimport.demo.runner import child_environment, verify_server
from invimport.demo.state import DemoState
from invimport.demo.workspace import create_workspace, load_workspace

ROOT = Path(__file__).resolve().parents[2]
REASON = "Reviewed this unchanged synthetic demo database, original instance nonce and saved record PKs"


@pytest.fixture
def environment(tmp_path):
    return dict(os.environ, PYTHONPATH=str(ROOT / "src"),
                INVENTREE_URL="https://real-target.invalid/", INVENTREE_TOKEN="REAL-CREDENTIAL-CANARY",
                INVENTREE_USER="REAL-USER-CANARY", INVENTREE_PASSWORD="REAL-PASSWORD-CANARY",
                DIGIKEY_CLIENT_ID="REAL-VENDOR-CANARY", INVIMPORT_STATE_DIR=str(tmp_path / "FORBIDDEN-state"),
                HTTP_PROXY="http://127.0.0.1:1", HTTPS_PROXY="http://127.0.0.1:1", ALL_PROXY="http://127.0.0.1:1")


def invoke(environment, *arguments):
    return subprocess.run([sys.executable, "-m", "invimport", "demo", *map(str, arguments)],
                          env=environment, cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)


@contextmanager
def server(environment, workspace, scenario=None, *, restart=False):
    arguments = [sys.executable, "-m", "invimport", "demo", "serve", "--workspace", str(workspace)]
    arguments += ["--restart"] if restart else ["--scenario", scenario]
    with (workspace.parent / (workspace.name + "-server.log")).open("w+", encoding="utf-8") as log:
        process = subprocess.Popen(arguments, env=environment, cwd=ROOT, stdout=subprocess.PIPE, stderr=log, text=True)
        try:
            ready = process.stdout.readline()
            assert ready, log.read()
            ready = json.loads(ready)
            assert ready["ready"]
            yield ready
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
            process.communicate(timeout=10)
            assert process.returncode == 0


def result(environment, *arguments, code=0):
    completed = invoke(environment, *arguments)
    assert completed.returncode == code, completed.stderr
    for canary in ("REAL-CREDENTIAL-CANARY", "REAL-USER-CANARY", "REAL-PASSWORD-CANARY", "REAL-VENDOR-CANARY"):
        assert canary not in completed.stdout + completed.stderr
    return json.loads(completed.stdout), completed


def inspected(environment, workspace):
    return result(environment, "inspect", workspace)[0]


@pytest.mark.parametrize("scenario", ["happy", "partial"])
def test_real_cli_http_partial_recovery_restart_and_no_duplicate_known_effects(environment, tmp_path, scenario):
    workspace = tmp_path / scenario
    with server(environment, workspace, scenario) as ready:
        assert ready["target"].startswith("http://127.0.0.1:")
        occupied = invoke(environment, "serve", "--workspace", workspace, "--restart")
        assert occupied.returncode == 1
        assert json.loads((workspace / "invimport-demo.json").read_text())["port"] == int(ready["target"].split(":")[-1].rstrip("/"))
        prepared, console = result(environment, "run", workspace, "prepare")
        assert prepared["prepared"] and "Resolved plan" in console.stderr
        initial = inspected(environment, workspace)
        assert initial["counts"]["stock/"] == initial["counts"]["part/"] == 0
        assert not any(request["method"] == "POST" and request["route"] != "barcode/" for request in initial["requests"])
        preview, _ = result(environment, "run", workspace, "execute")
        assert preview["preview_only"]
        assert inspected(environment, workspace)["counts"]["stock/"] == 0
        executed, console = result(environment, "run", workspace, "execute", "--write", code=1 if scenario == "partial" else 0)
        assert "request_started" in console.stderr and "operation_finished" in console.stderr
        original_run, original_ids = executed["run_id"], {row["id"] for row in executed["operations"]}
        remote = inspected(environment, workspace)
        assert remote["counts"]["part/"] == remote["counts"]["order/po/"] == 1
        assert remote["counts"]["stock/"] == remote["counts"]["order/po-line/"] == len(remote["barcodes"]) == 2
        lots = remote["records"]["stock/"]
        assert {row["batch"] for row in lots} == {"DEMO-A", "DEMO-B"}
        assert {row["quantity"] for row in lots} == {10, 20}
        contributions = remote["records"]["order/po-line/"]
        assert {row["purchase_price"] for row in contributions} == {0.1, 0.2}
        assert {row["purchase_price_currency"] for row in contributions} == {"AUD"}
        sends = [row for row in remote["requests"] if row["method"] == "POST" and row["route"] == "order/po-line/"]
        assert len(sends) == 2 and all(row["payload"]["merge_items"] is False and row["payload"]["auto_pricing"] is False for row in sends)
        assert any(row["route"] == "user/me/" for row in remote["requests"])
        assert any(row["route"].startswith("media/") for row in remote["requests"])
        if scenario == "partial":
            failed = [row for row in executed["operations"] if row["state"] == "failed"]
            assert len(failed) == 1
            selected = failed[0]["id"]
            assert remote["faults"] == [{"method": "POST", "route": "attachment/", "mode": "reject_before", "consumed": True}]
            assert len([row for row in remote["requests"] if row["outcome"] == "rejected_before_application"]) == 1
    # Status and inspection remain local with the listener CLOSED, in new processes.
    before_status = inspected(environment, workspace)
    status, _ = result(environment, "run", workspace, "status", code=1 if scenario == "partial" else 0)
    assert status["complete"] is (scenario == "happy")
    assert inspected(environment, workspace)["requests"] == before_status["requests"]
    with server(environment, workspace, restart=True) as restarted:
        assert restarted == ready
        if scenario == "partial":
            rejected = invoke(environment, "run", workspace, "retry-operation", selected, "--write")
            assert rejected.returncode == 1  # Actual CLI still requires continuity.
            recovered, _ = result(environment, "run", workspace, "retry-operation", selected, "--write", "--continuity-reason", REASON)
            assert recovered["run_id"] == original_run
            assert {row["id"] for row in recovered["operations"]} == original_ids
        final, _ = result(environment, "run", workspace, "status")
        assert final["complete"] and final["retention"]["complete"]
        if scenario == "partial":
            attempts = [attempt for attempt in final["attempts"] if attempt["operation"] == selected]
            assert [attempt["state"] for attempt in attempts] == ["failed", "succeeded"]
            assert attempts[0]["id"] != attempts[1]["id"]
            assert [attempt["number"] for attempt in attempts] == [1, 2]
        after = inspected(environment, workspace)
        blocked = invoke(environment, "run", workspace, "execute", "--write")
        assert blocked.returncode == 1 and "already has execution history" in blocked.stderr
        assert inspected(environment, workspace)["requests"] == after["requests"]
        for route in ("stock/", "part/", "order/po/", "order/po-line/"):
            assert after["records"][route] == remote["records"][route]
        labels = [row for row in after["records"]["attachment/"] if row["filename"] == "synthetic-label.txt"]
        assert len(labels) == 1
        content = (workspace / "source" / "synthetic-label.txt").read_bytes()
        assert next(row for row in after["media"] if row["pk"] == labels[0]["pk"])["sha256"] == sha256(content).hexdigest()
        result(environment, "run", workspace, "resume", "--write", "--continuity-reason", REASON)
        no_op = inspected(environment, workspace)
        assert no_op["records"] == after["records"] and no_op["media"] == after["media"]
    assert not (tmp_path / "FORBIDDEN-state").exists()
    assert (workspace / "state" / "execution" / "registry.sqlite3").exists()
    if os.name != "nt":
        assert workspace.stat().st_mode & 0o777 == 0o700
        assert (workspace / "server.sqlite3").stat().st_mode & 0o777 == 0o600


def test_owned_directory_refusal_missing_database_and_symlinks(environment, tmp_path):
    existing = tmp_path / "existing"
    existing.mkdir()
    sentinel = existing / "keep.txt"
    sentinel.write_text("must remain", encoding="utf-8")
    assert invoke(environment, "serve", "--workspace", existing, "--scenario", "happy").returncode == 1
    assert invoke(environment, "serve", "--workspace", existing, "--restart").returncode == 1
    assert sentinel.read_text(encoding="utf-8") == "must remain"
    workspace, _ = create_workspace(tmp_path / "demo", "happy")
    state = workspace / "server.sqlite3"
    state.unlink()
    assert invoke(environment, "inspect", workspace).returncode == 1
    assert not state.exists()
    alias = tmp_path / "alias"
    alias.symlink_to(workspace, target_is_directory=True)
    assert invoke(environment, "inspect", alias).returncode == 1


def test_wrong_instance_nonce_refuses_child_before_any_import_requests(environment, tmp_path):
    workspace = tmp_path / "demo"
    with server(environment, workspace, "happy"):
        marker = workspace / "invimport-demo.json"
        manifest = json.loads(marker.read_text())
        other, other_manifest = create_workspace(tmp_path / "other", "happy")
        # A valid separate demo server occupies the manifest's selected target.
        with DemoHTTPServer(DemoState(other / "server.sqlite3"), other_manifest["instance"]) as wrong:
            thread = threading.Thread(target=wrong.serve_forever, daemon=True)
            thread.start()
            try:
                manifest["port"] = wrong.server_port
                marker.write_text(json.dumps(manifest), encoding="utf-8")
                refused = invoke(environment, "run", workspace, "prepare")
                assert refused.returncode == 1 and "does not belong" in refused.stderr
                assert not (workspace / "output" / "plan.json").exists()
                assert [row["route"] for row in DemoState(other / "server.sqlite3").inspect()["requests"]] == ["identity"]
            finally:
                wrong.shutdown()
                thread.join(timeout=5)


def test_demo_ignores_env_file_before_dispatch(tmp_path, monkeypatch, capsys):
    def forbidden(_):
        pytest.fail("demo must never read actual .env")
    monkeypatch.setattr("invimport.__main__.load_env_file", forbidden)
    assert cli(["--env-file", str(tmp_path / "actual.env"), "demo", "inspect", str(tmp_path / "missing")]) == 1
    assert "DEMO error" in capsys.readouterr().err


def test_stub_default_merges_but_explicit_controls_preserve_source_contributions(tmp_path):
    path, _ = create_workspace(tmp_path / "demo", "happy")
    state = DemoState(path / "server.sqlite3")
    first = state.create("order/po-line/", {"order": 1, "part": 2, "quantity": "3"})
    merged = state.create("order/po-line/", {"order": 1, "part": 2, "quantity": "4"})
    assert merged["pk"] == first["pk"] and merged["quantity"] == "7"
    explicit = state.create("order/po-line/", {"order": 1, "part": 2, "quantity": "5", "merge_items": False,
                                           "auto_pricing": False, "reference": "source-lot", "purchase_price": "0.12", "purchase_price_currency": "AUD"})
    assert explicit["pk"] != first["pk"] and explicit["reference"] == "source-lot" and explicit["purchase_price"] == "0.12"


def test_identity_redirect_is_refused_before_following_it(tmp_path):
    visited = []

    class Redirect(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            visited.append(self.path)
            self.send_response(302)
            self.send_header("Location", "/must-not-be-visited")
            self.end_headers()

    with HTTPServer(("127.0.0.1", 0), Redirect) as listener:
        thread = threading.Thread(target=listener.serve_forever, daemon=True)
        thread.start()
        try:
            with pytest.raises(ValueError, match="redirects are forbidden"):
                verify_server({"port": listener.server_port, "instance": "unrelated"})
            assert visited == ["/demo/identity"]
        finally:
            listener.shutdown()
            thread.join(timeout=5)


def test_child_uses_running_package_despite_inherited_paths_and_shadow_cwd(environment, tmp_path, monkeypatch):
    workspace = tmp_path / "demo"
    with server(environment, workspace, "happy"):
        (workspace / "invimport.py").write_text("raise RuntimeError('shadow cwd imported')", encoding="utf-8")
        shadow = tmp_path / "shadow"
        shadow.mkdir()
        (shadow / "invimport.py").write_text("raise RuntimeError('shadow inherited imported')", encoding="utf-8")
        monkeypatch.setenv("PYTHONPATH", str(shadow) + os.pathsep + "relative-path")
        _, manifest = load_workspace(workspace)
        pinned = child_environment(workspace, manifest)
        assert pinned["PYTHONPATH"] == str(ROOT / "src")
        # Parent uses this implementation; child sees no inherited relative/shadow paths.
        script = "from pathlib import Path; from invimport.demo.runner import run_import; import os,sys; os.environ['PYTHONPATH']=sys.argv[2]; sys.exit(run_import(Path(sys.argv[1]), 'prepare'))"
        completed = subprocess.run([sys.executable, "-c", script, str(workspace), str(shadow)],
                                   env=environment, cwd=ROOT, capture_output=True, text=True, timeout=30)
        assert completed.returncode == 0, completed.stderr
        assert json.loads(completed.stdout)["prepared"]

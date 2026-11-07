"""Offline launch/observation regressions; no native login or inference is run."""
from __future__ import annotations

import json
from pathlib import Path
import runpy
import subprocess
import sys
from unittest.mock import patch

import pytest


ROOT = Path(__file__).resolve().parents[3]
SPIKE = ROOT / "spikes/subscription-runtime"
runtime = runpy.run_path(str(SPIKE / "runtime.py"))


def test_codex_actual_pinned_sdk_spawn_has_no_inherited_overrides(tmp_path):
    python = SPIKE / ".venv/bin/python"
    if not python.is_file():
        pytest.skip("Run uv sync --project spikes/subscription-runtime --locked for SDK spawn control")
    # Only the isolated child receives sentinels; no personal values/stores are
    # examined. Intercept the real pinned SDK's Popen, before any native launch.
    code = """
from importlib.metadata import version
import os
from pathlib import Path
import runpy
import sys
from unittest.mock import patch

assert version('openai-codex') == '0.163.0'
spike, directory = map(Path, sys.argv[1:])
sys.path.insert(0, str(spike))
module = runpy.run_path(str(spike / 'live_codex.py'))
try:
    module['configuration'](directory)
except module['GateBlocked'] as exc:
    assert str(exc) == 'unsanitized_process_environment'
else:
    raise AssertionError('embedded unsanitized launch accepted')

class SpawnIntercepted(BaseException):
    pass

def intercept(args, **kwargs):
    assert args[-3:] == ['app-server', '--listen', 'stdio://']
    environment = kwargs['env']
    for name in ('OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_HOME',
                 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'PYTHONPATH'):
        assert name not in environment, name
    assert set(environment) <= {'HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL',
                               'SSL_CERT_FILE', 'SSL_CERT_DIR', 'SYSTEMROOT', 'USER', 'LOGNAME'}
    assert environment['HOME'] == os.environ['HOME']
    assert Path(kwargs['cwd']) == directory / 'bundle'
    raise SpawnIntercepted()

sys.argv = [str(spike / 'live_codex.py'), 'start', str(directory)]
with patch('openai_codex.client.subprocess.Popen', side_effect=intercept):
    try:
        runpy.run_path(str(spike / 'live_codex.py'), run_name='__main__')
    except SpawnIntercepted:
        print('pinned_sdk_spawn_sanitized')
    else:
        raise AssertionError('SDK spawn was not reached')
"""
    environment = runtime["live_environment"]() | {"HOME": str(tmp_path / "empty-home")}
    for name in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME", "ANTHROPIC_API_KEY",
                 "CLAUDE_CODE_OAUTH_TOKEN", "PYTHONPATH"):
        environment[name] = "synthetic-not-a-credential"
    result = subprocess.run([str(python), "-c", code, str(SPIKE), str(tmp_path / "run")],
                            env=environment, capture_output=True, text=True, timeout=20, check=True)
    assert result.stdout.strip() == "pinned_sdk_spawn_sanitized"


@pytest.mark.parametrize("missing", [None, "all_tools", "packet-a.png", "packet-b.png", "receipt.pdf",
                                     "denial", "write_request", "question", "outside_read", "file_created"])
def test_claude_probe_requires_media_question_and_write_denial(tmp_path, missing):
    with patch.dict(sys.modules, {"runtime": type(sys)("runtime")}):
        sys.modules["runtime"].__dict__.update(runtime)
        claude = runpy.run_path(str(SPIKE / "live_claude.py"))
    directory = tmp_path / "run"
    bundle = directory / "bundle"
    retained = json.loads((SPIKE / "observed/claude-observation.json").read_text(encoding="utf-8"))
    output = retained["structured_output"]
    if missing == "question":
        output["question"] = "   "
    tools = []
    for entry in retained["tools_observed"]:
        if entry["tool"] == "StructuredOutput":
            continue
        if missing == entry["file"] or missing == "write_request" and entry["tool"] == "Write":
            continue
        relative = entry["file"] if entry["file"] in {"input.json", "denied.txt"} else "evidence/" + entry["file"]
        path = bundle / relative
        if missing == "outside_read" and entry["file"] == "packet-a.png":
            path = tmp_path / "outside/packet-a.png"
        tools.append({"type": "tool_use", "name": entry["tool"], "input": {"file_path": str(path)}})
    if missing == "all_tools":
        tools = []
    events = [{"type": "assistant", "message": {"content": tools}},
              {"type": "result", "is_error": False, "structured_output": output,
               "permission_denials": [] if missing in {"denial", "all_tools"} else [{"tool_name": "Write"}],
               "session_id": "synthetic-session"}]
    account = {"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro"}

    def fake_subprocess(command, **kwargs):
        if command[-1] == "--version":
            stdout = "2.1.316 (Claude Code)"
        elif command[-2:] == ["auth", "status"]:
            stdout = json.dumps(account)
        else:
            stdout = "\n".join(map(json.dumps, events))
            if missing == "file_created":
                (bundle / "denied.txt").write_text("synthetic boundary violation", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout, "")

    with patch.dict(claude["run"].__globals__, {"claude_command": lambda: ["synthetic-claude"]}), \
            patch("subprocess.run", side_effect=fake_subprocess):
        if missing is None:
            claude["run"](directory)
            observed = json.loads((directory / "observation.json").read_text(encoding="utf-8"))
            assert observed["structured_output"] == retained["structured_output"]
            assert observed["permission_denials"] == ["Write"]
        else:
            reason = "permission_boundary_failed" if missing == "file_created" else "inconclusive"
            with pytest.raises(RuntimeError, match=reason):
                claude["run"](directory)
            assert not (directory / "observation.json").exists()

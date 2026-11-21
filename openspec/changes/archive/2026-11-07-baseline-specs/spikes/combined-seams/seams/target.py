"""Reuse the public adapter and persistent fake; no copied execution internals."""

from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import subprocess
import sys
from threading import Thread

from adapter import FIXTURE, prepare, question_context, read_json
from fake_server import FaultServer
from invimport.demo.runner import child_environment
from invimport.demo.state import DemoState
from invimport.demo.workspace import create_workspace, load_workspace, save_json
from questions import Questions, WaitingForAnswer

from .observations import OBSERVED


def inspect_approval(path: Path, key: str) -> dict | None:
    _path, manifest = load_workspace(path)
    environment = child_environment(path, manifest)
    here = Path(__file__).resolve().parents[1]
    environment["PYTHONPATH"] += ":" + str(here.parent / "importer-adapter")
    result = subprocess.run([sys.executable, str(here / "inspect_binding.py"), str(path), key],
                            env=environment, capture_output=True, text=True, timeout=20, check=True)
    return json.loads(result.stdout)


def initialize(path: Path) -> Path:
    path, _ = create_workspace(path, "happy")
    shutil.copytree(FIXTURE / "evidence", path / "source/evidence")
    # Never call adapter.initialize: it copies the expected-proposal oracle.
    shutil.copy2(OBSERVED / "proposal.json", path / "source/proposal.json")
    shutil.copy2(FIXTURE / "input-confirmed.json", path / "source/input.json")
    for config in (FIXTURE / "config").iterdir():
        shutil.copy2(config, path / "config" / config.name)
    (path / "intents").mkdir(mode=0o700)
    (path / "questions").mkdir(mode=0o700)
    return path


@contextmanager
def running(path: Path):
    _path, manifest = load_workspace(path)
    state = DemoState(path / "server.sqlite3")
    with FaultServer(state, manifest["instance"], manifest["port"]) as server:
        manifest["port"] = server.server_port
        save_json(path / "invimport-demo.json", manifest)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield state, server
        finally:
            server.release_ack.set()
            server.shutdown()
            thread.join(timeout=3)


def selected_plan(path: Path, selected: list[str], *, known_part=None) -> tuple:
    for _ in range(5):
        try:
            return prepare(path, selected, known_part=known_part)
        except WaitingForAnswer as exc:
            # Authored reviewer choice, not a provider answer or automatic production policy.
            question = read_json(path / "questions" / (str(exc) + ".json"))["question"]
            reply = {key: question[key] for key in question_context(path)}
            reply.update(type="job.answer", question_id=question["question_id"],
                         question_revision=question["question_revision"], value="new", actor_id="fixture-user")
            Questions(path / "questions", question_context(path)).answer(reply)
    raise RuntimeError("bounded preparation failed to settle")

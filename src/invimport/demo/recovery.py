"""Recover a convenience locator from the owned canonical registry, read-only."""
from __future__ import annotations

from contextlib import closing
import json
from pathlib import Path
import sqlite3

from ..execution.journal_validation import validate_journal
from ..execution.models import Plan
from ..execution.ownership import normalize_endpoint
from .workspace import save_json


def recover_locator(path: Path, endpoint: str) -> dict | None:
    registry = path / "state" / "execution" / "registry.sqlite3"
    locator = path / "output" / "run.json"
    marker = registry.with_name("registry.initialized")
    if not registry.exists():
        if marker.exists() or locator.exists():
            raise ValueError("demo canonical registry missing; preserve recovery state")
        return None
    if registry.is_symlink() or not marker.is_file():
        raise ValueError("demo canonical registry ownership unavailable")
    with closing(sqlite3.connect(registry.as_uri() + "?mode=ro", uri=True)) as connection:
        connection.execute("BEGIN")
        if connection.execute("PRAGMA user_version").fetchone() != (1,) or connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("demo canonical registry is unsupported or corrupt")
        runs = connection.execute("SELECT run_id,location,revision FROM runs").fetchall()
        if len(runs) != 1:
            raise ValueError("demo requires exactly one canonical run; preserve registry for investigation")
        run_id, location, revision = runs[0]
        claims = connection.execute("SELECT run_id,location,revision FROM claims WHERE run_id=?", (run_id,)).fetchall()
        if claims != runs:
            raise ValueError("demo canonical claim differs from registered run")
    journal = Path(location)
    owned_runs = path / "state" / "execution" / "runs"
    if (journal.parent.parent != owned_runs or journal.name != "run.sqlite3"
            or journal.is_symlink() or journal.resolve() != journal or not journal.is_file()):
        raise ValueError("demo registered journal missing or outside its owned state")
    with closing(sqlite3.connect(journal.as_uri() + "?mode=ro", uri=True)) as connection:
        connection.execute("BEGIN")
        if connection.execute("PRAGMA user_version").fetchone() != (1,) or connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("demo registered journal is unsupported or corrupt")
        rows = connection.execute("SELECT id,revision,plan FROM run").fetchall()
        if len(rows) != 1 or rows[0][:2] != (run_id, revision):
            raise ValueError("demo registered journal identity differs")
        plan = Plan.loads(rows[0][2])
        if plan.revision != revision or normalize_endpoint(plan.target.endpoint) != normalize_endpoint(endpoint):
            raise ValueError("demo original plan revision or target differs")
        validate_journal(connection, plan=plan, run_id=run_id)
    recovered = {"run_id": run_id, "revision": revision}
    if locator.exists():
        previous = json.loads(locator.read_text(encoding="utf-8"))
        if (not isinstance(previous, dict) or previous.get("run_id") != run_id
                or previous.get("revision", revision) != revision):
            raise ValueError("demo run locator differs from canonical authority")
    save_json(locator, recovered)
    return recovered

"""Public canonical inspection for application-owned deterministic run locations."""
from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from .models import Plan
from .ownership import JournalError, Registry, state_root
from .store import load_run_status


@dataclass(frozen=True)
class CanonicalBinding:
    run_id: str
    state: str
    snapshot: dict | None


def inspect_binding(plan: Plan, run_directory: Path) -> CanonicalBinding | None:
    """Return canonical state before redelivering an approved start intent.

    None means no binding or unresolved earlier claim was found, not a lease.
    A reservation without a journal is deliberately returned with no snapshot;
    only operator recovery can resolve it. Never start again in that case.
    Existing snapshots are verified through the canonical status API. No remote
    calls, replay, claim clearing or migration are performed.
    """
    directory = state_root() / "execution"
    if not (directory / "registry.sqlite3").exists():
        if (directory / "registry.initialized").exists() or run_directory.exists():
            raise JournalError("canonical authority missing; recovery required")
        return None
    with closing(Registry()) as registry:
        found = registry.inspect_binding(plan.target, plan.import_id,
                                         location=run_directory / "run.sqlite3",
                                         revision=plan.revision)
    if found is None:
        if run_directory.exists():
            raise JournalError("unregistered bound directory; recovery required")
        return None
    run_id, state = found
    journal = run_directory / "run.sqlite3"
    if not journal.is_file() or journal.is_symlink():
        return CanonicalBinding(run_id, "recovery_required", None)
    snapshot = load_run_status(run_id)
    if snapshot["revision"] != plan.revision:
        raise JournalError("canonical revision differs from approval")
    return CanonicalBinding(run_id, state, snapshot)

"""Initial retained-run policy; immutable evidence migration belongs to Stage 5."""
from __future__ import annotations

from pathlib import Path

from .ownership import private_directory, state_root


RUN_MARKER = ".invimport-run"


def initialize_run_directory(directory: Path) -> None:
    private_directory(directory)
    private_directory(directory / "artifacts")
    marker = directory / RUN_MARKER
    marker.write_text("invimport execution run schema 1\n", encoding="utf-8")
    marker.chmod(0o600)


def is_execution_file(path: Path) -> bool:
    """Never recursively archive a canonical state root or custom run directory."""
    resolved = path.resolve()
    if resolved.is_relative_to(state_root().resolve()):
        return True
    if any((parent / RUN_MARKER).is_file() for parent in resolved.parents):
        return True
    return path.name in {base + suffix for base in ("run.sqlite3", "registry.sqlite3")
                         for suffix in ("", "-wal", "-shm", "-journal")}

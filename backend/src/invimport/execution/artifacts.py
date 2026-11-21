"""Private run initialization and identity-based evidence exclusions."""
from __future__ import annotations

from pathlib import Path
from hashlib import sha256
from typing import Mapping

from .ownership import private_directory, state_root


RUN_MARKER = ".invimport-run"


def initialize_run_directory(directory: Path) -> None:
    private_directory(directory)
    private_directory(directory / "artifacts")
    marker = directory / RUN_MARKER
    marker.write_text("invimport execution run schema 1\n", encoding="utf-8")
    marker.chmod(0o600)


def is_owned_execution_file(path: Path) -> bool:
    """Identify execution state by canonical or marked owner roots."""
    resolved = path.resolve()
    if resolved.is_relative_to(state_root().resolve()):
        return True
    if any((parent / RUN_MARKER).is_file() for parent in resolved.parents):
        return True
    return False


def is_execution_file(path: Path) -> bool:
    """Legacy conservative exclusion; full manifests use owned-root identity."""
    if is_owned_execution_file(path):
        return True
    return path.name in {base + suffix for base in ("run.sqlite3", "registry.sqlite3")
                         for suffix in ("", "-wal", "-shm", "-journal")}


def retained_artifact_status(directory: Path, receipt: Mapping) -> str:
    """Read-only retention evidence; never changes historical remote outcomes."""
    filename = receipt.get("filename")
    if not isinstance(filename, str) or Path(filename).name != filename or filename in {".", ".."}:
        return "corrupt"
    root = directory / "artifacts"
    path = root / filename
    try:
        if not path.is_file():
            return "missing"
        if not path.resolve().is_relative_to(root.resolve()):
            return "corrupt"
        content = path.read_bytes()
        return "verified" if len(content) == receipt["size"] and sha256(content).hexdigest() == receipt["sha256"] else "corrupt"
    except OSError:
        return "unavailable"


def retention_snapshot(directory: Path, snapshot: Mapping) -> dict:
    artifacts = [{**receipt, "status": retained_artifact_status(directory, receipt)}
                 for receipt in snapshot.get("prepared_artifacts", [])]
    return {"checked": True, "complete": all(item["status"] == "verified" for item in artifacts), "artifacts": artifacts}

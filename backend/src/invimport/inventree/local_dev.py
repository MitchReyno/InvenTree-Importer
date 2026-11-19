"""
The local development InvenTree as the importer's default server.

`pnpm inventree:dev up` runs an InvenTree at a fixed address and keeps its API
tokens in a private state file. When no InvenTree server is configured, the
importer uses that instance's writer token, so a developer with the local
stack needs no server settings. The state directory rule, file name and
address are shared with `tooling/inventree-dev/lib.cjs` and
`intake-server/src/dev/pg-identity.ts`; `tooling/tests/inventree-dev-contract.test.cjs`
keeps them in step.
"""

from __future__ import annotations

import json
import os
import re
import stat
from collections.abc import Callable, Mapping, MutableMapping
from pathlib import Path

LOCAL_DEV_ORIGIN = "http://127.0.0.1:4320"
STATE_FILE_NAME = "inventree-dev.json"
DEFAULT_STATE_DIRECTORY = Path(".local/state/bench-intake")
INVENTREE_SETTINGS = ("INVENTREE_URL", "INVENTREE_TOKEN", "INVENTREE_USER", "INVENTREE_PASSWORD")

# The same limit and token form as the Node side's private-file read and state validation.
_MAX_STATE_BYTES = 16384
_TOKEN = re.compile(r"^inv-[A-Za-z0-9]{20,80}-\d{8}$", re.ASCII)
_PRIVATE_MODE_BITS = 0o077


def development_state_directory(environ: Mapping[str, str]) -> Path:
    """`INTAKE_DEV_STATE`, else the home directory's bench-intake state, as `pg-identity.ts` resolves it."""
    configured = environ.get("INTAKE_DEV_STATE")
    if configured is not None:
        return Path(configured).resolve()
    return Path.home() / DEFAULT_STATE_DIRECTORY


def _private(entry: os.stat_result, *, kind: Callable[[int], bool]) -> bool:
    return kind(entry.st_mode) and entry.st_uid == os.getuid() and not entry.st_mode & _PRIVATE_MODE_BITS


def read_local_writer_token(directory: Path) -> str | None:
    """
    The local instance's writer token, or None when there is no usable local instance.

    The directory and file must be owned by this user and closed to others, and the
    file must be a regular file (not a link) holding a version 1 state with a
    well-formed writer token. Anything else is treated as no local instance.
    """
    try:
        if not _private(directory.lstat(), kind=stat.S_ISDIR):
            return None
        path = directory / STATE_FILE_NAME
        entry = path.lstat()
        if not _private(entry, kind=stat.S_ISREG) or entry.st_size > _MAX_STATE_BYTES:
            return None
        state = json.loads(path.read_text(encoding="utf-8"))
    # ValueError covers bad text, bad JSON and integers past Python's digit limit.
    except (OSError, ValueError):
        return None
    # JSON true and 1.0 compare equal to 1 in Python; only the integer is version 1.
    if not isinstance(state, dict) or type(state.get("version")) is not int or state["version"] != 1:
        return None
    tokens = state.get("tokens")
    writer = tokens.get("writer") if isinstance(tokens, dict) else None
    # fullmatch: `$` alone would accept a trailing newline.
    if not isinstance(writer, str) or not _TOKEN.fullmatch(writer):
        return None
    return writer


def apply_local_inventree_default(
    environ: MutableMapping[str, str], *, report: Callable[[str], None]
) -> bool:
    """
    Fill in the local instance when no InvenTree setting has a value.

    An empty value counts as unset, so a `.env` copied from the template still
    falls back. Any non-empty setting leaves the environment untouched. Returns
    whether the default was applied; `report` gets a line naming the server,
    never the token.
    """
    if any(environ.get(name) for name in INVENTREE_SETTINGS):
        return False
    token = read_local_writer_token(development_state_directory(environ))
    if token is None:
        return False
    environ["INVENTREE_URL"] = LOCAL_DEV_ORIGIN
    environ["INVENTREE_TOKEN"] = token
    report(f"Using the local development InvenTree at {LOCAL_DEV_ORIGIN} (no InvenTree server configured).")
    return True

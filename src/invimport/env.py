"""Credential loading from a .env file."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import dotenv_values

log = logging.getLogger(__name__)

# .env sits at the repo root: up out of the module, the package, then src/.
DEFAULT_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env_file(path: Path) -> int:
    """
    Load KEY=VALUE pairs from a .env file into os.environ.

    Parsing is python-dotenv's, so quoting, escapes, `export ` prefixes and
    comments all behave the way they do everywhere else.

    Interpolation is off deliberately. This file holds secrets, and with it on
    there is no way to write a literal "${": quoted, unquoted and single-quoted
    values all expand alike, and an unset name silently becomes empty. A
    mangled secret surfaces as a puzzling 401, so the trade is not worth it -
    nothing here needs ${VAR} expansion.

    The merge is done here rather than with load_dotenv() to keep the
    precedence rule explicit: a variable already set in the real environment is
    never overwritten, so exporting one still beats the file.

    Returns the number of variables actually taken from the file.
    """
    if not path.exists():
        return 0

    loaded = 0
    for key, value in dotenv_values(path, interpolate=False).items():
        if value is None:
            # A bare key with no '=' - nothing to assign.
            log.warning("    [warn] %s: %r has no value, ignored", path.name, key)
            continue
        if key not in os.environ:
            os.environ[key] = value
            loaded += 1

    return loaded

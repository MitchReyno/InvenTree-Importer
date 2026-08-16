"""
invimport - one entrypoint for the InvenTree import tooling.

    invimport <command> [options]           (or: python -m invimport ...)

Commands
--------
    product        fetch DigiKey product data by SKU
    orders         fetch DigiKey order history and sales orders
    import-orders  import DigiKey orders into InvenTree as purchase orders
    parameters     create and update InvenTree parameter templates
    categories     create and update InvenTree part categories

Run `invimport <command> --help` for a command's own options and notes.

Credentials
-----------
Read from a .env file at the repo root (override with --env-file). Real
environment variables take precedence, so you can still export one for a
single run. Never hard-code them, never commit the .env.

    DIGIKEY_CLIENT_ID=...
    DIGIKEY_CLIENT_SECRET=...
    DIGIKEY_ACCOUNT_ID=...        # orders only
    INVENTREE_URL=https://inventree.example.com
    INVENTREE_TOKEN=...           # or INVENTREE_USER + INVENTREE_PASSWORD

Setup
-----
    uv sync
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .commands import COMMANDS
from .config import ConfigError
from .digikey.api import DigiKeyError
from .env import DEFAULT_ENV_FILE, load_env_file
from .inventree.api import InvenTreeError


def program_name() -> str:
    """
    How the user invoked us, so help text matches what they typed. Running via
    `python -m invimport` puts __main__.py in argv[0]; the console script puts
    its own name there.
    """
    invoked = Path(sys.argv[0]).name if sys.argv and sys.argv[0] else ""
    return "python -m invimport" if invoked in ("__main__.py", "") else invoked


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=program_name(),
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE,
                        metavar="PATH",
                        help="file to read credentials from (default: .env at the "
                             "repo root); real environment variables take "
                             "precedence")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="include debug-level log output")

    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")
    for module in COMMANDS:
        sub = subparsers.add_parser(
            module.NAME,
            help=module.HELP,
            description=module.__doc__,
            formatter_class=argparse.RawDescriptionHelpFormatter,
        )
        module.add_arguments(sub)
        sub.set_defaults(_run=module.run)

    return parser


def configure_logging(verbose: bool = False) -> None:
    """
    Library modules log rather than print, so an importing caller controls
    their output. The CLI routes that to stderr, bare, matching the old format.
    """
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root = logging.getLogger("invimport")
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if verbose else logging.INFO)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not getattr(args, "_run", None):
        parser.print_help()
        return 2

    configure_logging(args.verbose)

    # Load credentials once, up front, so every command sees the same env.
    load_env_file(args.env_file)
    return args._run(args)


def cli(argv: list[str] | None = None) -> int:
    """
    Process entrypoint, turning expected failures into clean exits.

    Both `invimport` (the console script) and `python -m invimport` come
    through here, so neither can lose the friendly error handling. main() is
    left to raise, which keeps it usable from tests and other code.
    """
    try:
        return main(argv)
    except (ConfigError, DigiKeyError, InvenTreeError) as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(cli())

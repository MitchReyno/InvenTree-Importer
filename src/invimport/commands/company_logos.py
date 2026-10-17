"""
Give companies on the server that have no logo one.

    invimport company-logos                         # list those with no logo
    invimport company-logos --json missing.json     # the same, for an agent
    invimport company-logos logos.json              # dry run: what it would set
    invimport company-logos logos.json --write

The logos file is the `companies` section of a stock file on its own, JSON or
YAML, with paths relative to the file:

    {"companies": {"YAGEO": {"image": "logos/yageo.png"}}}

Names are matched as manufacturers and suppliers are everywhere else -
normalised, then through the learned aliases - and never fuzzy-matched. A
company that already has a logo keeps it; nothing is replaced or deleted.

For a company an import is about to create, give its logo in that stock
file's own `companies` section instead; this command only finds companies
already on the server.

The logic lives in invimport.inventree.companies; this module is the CLI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .. import provenance
from ..inventree import ledger
from ..inventree.api import connect
from ..inventree.companies import (
    FAILED,
    HAS_ONE,
    NOT_FOUND,
    SET,
    WOULD_SET,
    config_aliases,
    missing_logos,
    set_logos,
)
from ..inventree.purchase_orders import attach_file
from ..inventree.stockimport import invimport_version
from ..stockfile import Problem, StockFileError, parse_companies, parse_text

NAME = "company-logos"
HELP = "list companies with no logo, or set logos from a file"

MARKS = {SET: "+", WOULD_SET: "+", HAS_ONE: "=", NOT_FOUND: "-", FAILED: "!"}


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("file", nargs="?", type=Path, metavar="FILE",
                        help="logos file to apply (.json or .yaml); without "
                             "one, list the companies that have no logo")
    parser.add_argument("--write", action="store_true",
                        help="upload the logos (default is dry run)")
    parser.add_argument("--json", type=Path, default=None, metavar="PATH",
                        help="write the list of companies with no logo to a "
                             "JSON file")
    parser.add_argument("--config", type=Path, default=None, metavar="DIR",
                        help="config directory, for the learned aliases "
                             "(default: config/ at the repo root)")


def read_logos(path: Path) -> dict[str, dict[str, str]]:
    """The `companies` of a logos file, or StockFileError naming what is wrong."""
    try:
        data = parse_text(path.read_text(encoding="utf-8"), path.suffix)
    except OSError as exc:
        raise StockFileError(f"cannot read {path}: {exc}") from exc
    if not isinstance(data, dict) or "companies" not in data:
        raise StockFileError(
            f"{path}: a logos file is a mapping with a 'companies' section")
    problems: list[Problem] = []
    companies = parse_companies(data["companies"], problems)
    if problems:
        raise StockFileError("\n".join(p.describe() for p in problems))
    return companies


def list_missing(args: argparse.Namespace) -> int:
    companies = missing_logos(connect())
    rows = [{
        "pk": c.pk,
        "name": str(c.name),
        "is_manufacturer": bool(getattr(c, "is_manufacturer", False)),
        "is_supplier": bool(getattr(c, "is_supplier", False)),
        "website": str(getattr(c, "website", "") or ""),
        "description": str(getattr(c, "description", "") or ""),
    } for c in companies]
    for row in rows:
        kinds = "/".join(k for k, flag in (("manufacturer",
                                            row["is_manufacturer"]),
                                           ("supplier", row["is_supplier"]))
                         if flag) or "-"
        print(f"  {row['pk']:>5}  {row['name']:<40} {kinds:<22} "
              f"{row['website']}")
    print(f"\n{len(rows)} compan{'y' if len(rows) == 1 else 'ies'} with no "
          f"logo.")
    if args.json:
        args.json.write_text(json.dumps(rows, indent=2) + "\n",
                             encoding="utf-8")
        print(f"Wrote {args.json}")
    return 0


def run(args: argparse.Namespace) -> int:
    if args.file is None:
        return list_missing(args)

    try:
        wanted = read_logos(args.file)
    except StockFileError as exc:
        print(f"ERROR: {exc}")
        return 2

    if not args.write:
        print("DRY RUN - nothing will be changed on the server.\n")
    api = connect()
    with ledger.recording() as book:
        actions = set_logos(api, wanted, write=args.write,
                            base_dir=args.file.resolve().parent,
                            aliases=config_aliases(args.config))
    for action in actions:
        target = (f" -> {action.company} (pk {action.pk})"
                  if action.company and action.company != action.name else "")
        detail = f" - {action.reason}" if action.reason else ""
        print(f"  {MARKS.get(action.action, ' ')} {action.name}{target}: "
              f"{action.action}{detail}")

    attached = attach_provenance(api, args.file.resolve(), wanted, actions,
                                 book) if args.write else 0

    counts = {a: sum(1 for x in actions if x.action == a) for a in MARKS}
    done = counts[SET] if args.write else counts[WOULD_SET]
    print(f"\n{done} {'set' if args.write else 'to set'}, {counts[HAS_ONE]} "
          f"already had one, {counts[NOT_FOUND]} not on the server, "
          f"{counts[FAILED]} whose image could not be read.")
    if attached:
        print(f"Provenance JSON attached to {attached} compan"
              f"{'y' if attached == 1 else 'ies'}.")
    if not args.write:
        print("Dry run - nothing was uploaded. Re-run with --write to apply.")
    return 1 if counts[NOT_FOUND] or counts[FAILED] else 0


def attach_provenance(api, path: Path, wanted, actions, book) -> int:
    """Each company given a logo keeps where it came from."""
    run_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    docs = provenance.logo_records(path, wanted, actions, book, run=run_at,
                                   version=invimport_version())
    done = 0
    with tempfile.TemporaryDirectory() as tmp:
        for (model, pk), doc in docs.items():
            text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            out = Path(tmp) / (f"{provenance.RECORD_PREFIX}{path.parent.name}"
                               f"-{model}-{pk}-"
                               f"{digest[:provenance.DIGEST_LENGTH]}.json")
            out.write_text(text, encoding="utf-8")
            if attach_file(api, model, pk, out,
                           f"{provenance.RECORD_COMMENT}: {path.name} - "
                           f"where the logo came from"):
                done += 1
    return done

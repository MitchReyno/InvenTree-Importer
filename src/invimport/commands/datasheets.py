"""
Attach a copy of each part's linked datasheet, so it is kept on the server.

    invimport datasheets                                  # dry run
    invimport datasheets --write
    invimport datasheets --category "Integrated Circuits/Memory" --write

For every part without a datasheet attachment, the links on its manufacturer
parts and on the part itself are tried in that order. The first that
downloads as a real PDF is attached to the part, and to each manufacturer part
carrying the same link, with the comment "Datasheet". A link that is a
product page, a viewer or a dead URL is reported and skipped.

Dry run by default. A dry run still downloads - it is the only way to tell a
PDF from a web page - but uploads nothing; downloads are cached under
.cache/datasheets/, so the run that writes does not fetch them again. Nothing
is deleted, and a part that already has a datasheet attached is left alone.

A link ending '#page=N' is mirrored as the whole document. To add an extract
of one device's pages of a data book, name the file in a stock file with
datasheet_pages and import it with --mirror-datasheets.

The logic lives in invimport.inventree.datasheets; this module is the CLI.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from ..inventree.api import connect
from ..inventree.datasheets import (
    ATTACHED,
    DATASHEETS_DIR,
    DOWNLOAD_WORKERS,
    FAILED,
    HAS_ONE,
    NO_LINK,
    WOULD_ATTACH,
    BackfillItem,
    backfill,
)

NAME = "datasheets"
HELP = "attach a copy of each part's linked datasheet"

MARKS = {ATTACHED: "+", WOULD_ATTACH: "+", HAS_ONE: "=", NO_LINK: "-",
         FAILED: "!"}


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--write", action="store_true",
                        help="upload the attachments (default is dry run)")
    parser.add_argument("--category", metavar="PATH", default="",
                        help="only parts in this category and below, e.g. "
                             "'Integrated Circuits/Memory'")
    parser.add_argument("--all", action="store_true",
                        help="also list parts that already have a datasheet "
                             "or have no link at all")
    parser.add_argument("--jobs", type=int, default=DOWNLOAD_WORKERS,
                        metavar="N",
                        help=f"downloads to run at once (default: "
                             f"{DOWNLOAD_WORKERS}; 1 for one at a time)")
    parser.add_argument("--refresh", action="store_true",
                        help="download again even if a datasheet is cached")
    parser.add_argument("--cache-dir", type=Path, default=DATASHEETS_DIR)


def run(args: argparse.Namespace) -> int:
    if not args.write:
        print("DRY RUN - nothing will be changed on the server.\n")

    def report(item: BackfillItem) -> None:
        if not args.all and item.action in (HAS_ONE, NO_LINK):
            return
        mark = MARKS.get(item.action, " ")
        print(f"  {mark} {item.ipn or item.part:<12} {item.name}", flush=True)
        if item.file:
            print(f"      {item.action}: {item.file}  <- {item.url}")
        elif item.action == FAILED:
            print(f"      {item.reason}  <- {item.url}")

    api = connect()
    try:
        items = backfill(api, write=args.write, category=args.category,
                         cache_dir=args.cache_dir, refresh=args.refresh,
                         workers=args.jobs, on_item=report)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 2

    counts = {action: sum(1 for i in items if i.action == action)
              for action in (ATTACHED, WOULD_ATTACH, HAS_ONE, NO_LINK, FAILED)}
    done = counts[ATTACHED] if args.write else counts[WOULD_ATTACH]
    print(f"\n{done} {'attached' if args.write else 'to attach'}, "
          f"{counts[HAS_ONE]} already had one, {counts[NO_LINK]} with no "
          f"link, {counts[FAILED]} whose link is not a PDF or would not "
          f"download.")
    if not args.write:
        print("Dry run - nothing was uploaded. Re-run with --write to apply.")
    return 0

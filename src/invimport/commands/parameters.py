"""
Create PartParameterTemplate records and attach PartParameter values to parts,
via the InvenTree REST API.

Parameters cannot ride along in the Part import file: the CSV importer handles
one model per file, and part-plus-parameter columns are a known failure. So
parameters are loaded separately, and the API is the reliable route.

Two stages, both idempotent:
  1. Ensure every template in the templates CSV exists (create or update).
  2. Ensure every (part, template) pair in the values CSV has the right value.

Re-running is safe. Nothing is deleted, ever.

Targets InvenTree API 530+ - see invimport/inventree/api.py for the route and
model_type changes that entails.

Input formats
-------------
templates CSV: name, units, description, choices, checkbox
values CSV:    part_ipn, template, data, source
               'source' is documentation only - it is not sent to InvenTree.
               Use it to record where each figure came from so a later reader
               can tell a datasheet value from a supplier-listing value.

    invimport parameters --templates t.csv --values v.csv          # dry run
    invimport parameters --templates t.csv --values v.csv --write  # apply

The logic lives in invimport.inventree.parameters; this module is only the CLI.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from ..inventree.api import connect
from ..inventree.parameters import SyncResult, load_parameters

NAME = "parameters"
HELP = "load part parameter templates and values into InvenTree"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--templates", type=Path, required=True)
    parser.add_argument("--values", type=Path, required=True)
    parser.add_argument("--write", action="store_true",
                        help="apply changes (default is dry run)")


def report(result: SyncResult) -> None:
    print("Stage 1: parameter templates")
    for action in result.templates:
        if action.action == "created":
            print(f"  + template '{action.name}' (units={action.units or 'none'})")
        elif action.action == "updated":
            drift = ", ".join(f"{k}: {old!r} -> {new!r}"
                              for k, (old, new) in action.drift.items())
            print(f"  ~ template '{action.name}' differs: {drift}")
        else:
            print(f"  = template '{action.name}' ok")

    if result.templates_pending:
        print("\nSome templates do not exist yet. In dry-run mode their parameter "
              "values cannot be checked against the server.\nRe-run with --write "
              "to create templates, then dry-run again to preview values.")
        return

    print("\nStage 2: part parameters")
    for value in result.values:
        if value.action == "created":
            print(f"  + {value.ipn} {value.template} = {value.new}")
        elif value.action == "updated":
            print(f"  ~ {value.ipn} {value.template}: {value.old!r} -> {value.new!r}")

    counts = result.counts()
    print(f"\n  created={counts['created']}  updated={counts['updated']}  "
          f"unchanged={counts['unchanged']}")

    if result.problems:
        print(f"\n  {len(result.problems)} problem(s):")
        for problem in result.problems:
            print(f"    ! {problem}")


def run(args: argparse.Namespace) -> int:
    api = connect()
    if not args.write:
        print("DRY RUN - nothing will be changed.\n")

    result = load_parameters(args.templates, args.values, api, write=args.write)
    report(result)

    if not args.write and not result.templates_pending:
        print("\nDRY RUN complete - re-run with --write to apply.")
    return 0

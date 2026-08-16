"""
Create and update InvenTree parameter templates from config/parameters.yaml.

Templates are the vocabulary the part import writes against: a category names
the parameters its parts carry, and every one of those has to exist as a
template with the right units before any value can be stored. This command
puts the server in step with the config.

    invimport parameters                  # dry run: report what would change
    invimport parameters --write          # apply
    invimport parameters --config ./other # a different config directory

Custom units from config/units.yaml are ensured first: a template declares its
unit by name and InvenTree rejects one it cannot resolve, so ppm_per_delta_degC
has to exist before any template that uses it.

Idempotent, and nothing is ever deleted. A template on the server that the
config does not mention is reported, not removed - parts may be using it.

Parameter *values* are not set here; they come from supplier data as parts are
imported. The templates/values CSV pair this command used to take is gone.

The logic lives in invimport.inventree.parameters; this module is only the CLI.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from ..inventree.api import connect
from ..inventree.parameters import SyncResult, sync_config
from ..inventree.units import UnitSyncResult

NAME = "parameters"
HELP = "create and update InvenTree parameter templates from the config"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", type=Path, default=None, metavar="DIR",
                        help="config directory (default: config/ at the repo "
                             "root)")
    parser.add_argument("--write", action="store_true",
                        help="apply changes (default is dry run)")


def report_units(result: UnitSyncResult) -> None:
    print("Custom units")

    if not result.units:
        print("  (none defined)")
    for action in result.units:
        if action.action == "created":
            print(f"  + {action.name} = {action.definition}")
        elif action.action == "updated":
            drift = ", ".join(f"{key}: {old!r} -> {new!r}"
                              for key, (old, new) in action.drift.items())
            print(f"  ~ {action.name} differs: {drift}")
        else:
            print(f"  = {action.name} ok")

    counts = result.counts()
    print(f"\n  created={counts['created']}  updated={counts['updated']}  "
          f"unchanged={counts['unchanged']}")

    if result.unmanaged:
        print(f"  {len(result.unmanaged)} custom unit(s) on the server are not "
              f"in the config: {', '.join(result.unmanaged)}")

    for problem in result.problems:
        print(f"    ! {problem}")


def report(result: SyncResult) -> None:
    print("\nParameter templates")

    for action in result.templates:
        if action.action == "created":
            print(f"  + {action.name} (units={action.units or 'none'})")
        elif action.action == "updated":
            drift = ", ".join(f"{key}: {old!r} -> {new!r}"
                              for key, (old, new) in action.drift.items())
            print(f"  ~ {action.name} differs: {drift}")
        else:
            print(f"  = {action.name} ok")

    counts = result.counts()
    print(f"\n  created={counts['created']}  updated={counts['updated']}  "
          f"unchanged={counts['unchanged']}")

    if result.unmanaged:
        print(f"\n  {len(result.unmanaged)} template(s) on the server are not "
              f"in the config:")
        for name in result.unmanaged:
            print(f"    ? {name}")
        print("  Left alone - add them to config/parameters.yaml to manage "
              "them, or\n  delete them in InvenTree if they are unused.")

    if result.problems:
        print(f"\n  {len(result.problems)} problem(s):")
        for problem in result.problems:
            print(f"    ! {problem}")


def run(args: argparse.Namespace) -> int:
    if not args.write:
        print("DRY RUN - nothing will be changed.\n")

    api = connect()
    # Units before templates: a template naming a unit the server cannot
    # resolve is rejected, so the custom ones have to exist first.
    units, result = sync_config(args.config, api, write=args.write)
    report_units(units)
    report(result)

    if not args.write:
        print("\nDRY RUN complete - re-run with --write to apply.")
    return 0

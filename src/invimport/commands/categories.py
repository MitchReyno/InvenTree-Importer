"""
Create and update InvenTree part categories from config/categories.yaml.

    invimport categories                  # dry run: report what would change
    invimport categories --write          # apply
    invimport categories --learn          # map unmapped DigiKey paths
    invimport categories --config ./other

Templates are ensured first: a category names the parameters its parts
carry, and those have to exist as templates before any value can be stored.

`--learn` prompts for DigiKey category paths that no alias claims and writes
the chosen mapping back into the YAML, so the same path is never asked
about twice. The menu starts at the top-level categories, marks which are
structural and how many children they have, and drills down. Create is
offered at the current level. Paths come from the product cache, or from
arguments.

The logic lives in invimport.inventree.categories; this module is only the CLI.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from ..config import CONFIG_DIR, load_categories_config
from ..inventree.api import connect
from ..inventree.categories import (
    CategorySyncResult,
    NewCategory,
    cached_category_paths,
    children_of,
    describe_category,
    learn_aliases,
    parent_of,
    sync_tree,
)
from . import _keys as keys
from . import _prompt
from .parameters import report as report_templates
from .parameters import report_units

NAME = "categories"
HELP = "create and update InvenTree part categories from the config"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", type=Path, default=None, metavar="DIR",
                        help="config directory (default: config/ at the repo "
                             "root)")
    parser.add_argument("--write", action="store_true",
                        help="apply category and template changes (default is "
                             "dry run)")
    parser.add_argument("--check", action="store_true",
                        help="report drift only (the default)")
    parser.add_argument("--learn", action="store_true",
                        help="interactively map unmapped DigiKey category paths "
                             "and write the aliases back to the YAML")
    parser.add_argument("paths", nargs="*", metavar="PATH",
                        help="DigiKey category paths to learn (default: scan "
                             "the product cache)")


def report_categories(result: CategorySyncResult) -> None:
    print("\nPart categories")

    for action in result.categories:
        if action.action == "created":
            print(f"  + {action.pathstring}")
        elif action.action == "updated":
            drift = ", ".join(f"{key}: {old!r} -> {new!r}"
                              for key, (old, new) in action.drift.items())
            print(f"  ~ {action.pathstring} differs: {drift}")
        else:
            print(f"  = {action.pathstring} ok")

    counts = result.counts()
    print(f"\n  created={counts['created']}  updated={counts['updated']}  "
          f"unchanged={counts['unchanged']}")

    if result.unmanaged:
        print(f"\n  {len(result.unmanaged)} categor(y/ies) on the server are "
              f"not in the config:")
        for name in result.unmanaged:
            print(f"    ? {name}")
        print("  Left alone - add them to config/categories.yaml to manage "
              "them, or\n  delete them in InvenTree if they are unused.")

    if result.problems:
        print(f"\n  {len(result.problems)} problem(s):")
        for problem in result.problems:
            print(f"    ! {problem}")


# Not a category - the renderer and the browser special-case it.
CREATE = object()


def _choose(options, path):
    """
    Walk the category tree from the roots down.

    ENTER opens a folder or picks a leaf. SPACE picks the highlighted
    category even if it has children (unless it is structural). → opens,
    ← goes back. Create is always offered at the current level.
    """
    by_path = {c.pathstring: c for c in options}
    current = None

    def render(item):
        if item is CREATE or item == "__create__":
            return "create a new category here"
        return describe_category(item, by_path)

    while True:
        items = [*children_of(current, by_path), CREATE]
        title = f"DigiKey path {path!r} is not mapped."
        if current is not None:
            title += f"\n  {current.pathstring}"

        picked = _prompt.choose_row(items, render, title=title,
                                    prompt="  map to > ")
        if picked is None:
            return None
        item, action = picked
        if action == keys.LEFT:
            if current is None:
                return None
            current = parent_of(current, by_path)
            continue
        if item is CREATE or item == "__create__":
            return _ask_new_category(path, current)

        kids = children_of(item, by_path)
        # → always opens, even a leaf, so a child can be created under it.
        # ENTER opens a folder (or a structural category) and picks a leaf.
        if action == keys.RIGHT or (
                action == keys.SUBMIT and (kids or item.structural)):
            current = item
            continue
        if item.structural:
            continue
        return item


def _ask_new_category(path, parent) -> NewCategory | None:
    """Name a category at the current level. A slash nests children."""
    default = path.rsplit(" / ", 1)[-1]
    name = _prompt.ask(f"  name [{default}] > ")
    if name is None:
        return None
    parts = [part.strip() for part in (name or default).split("/") if part.strip()]
    if not parts:
        return None
    if parent is None:
        return NewCategory(parts)
    return NewCategory([*parent.path, *parts])


def run(args: argparse.Namespace) -> int:
    if not args.write:
        print("DRY RUN - nothing will be changed on the server.\n")

    api = connect()
    units, templates, categories = sync_tree(args.config, api, write=args.write)
    report_units(units)
    report_templates(templates)
    report_categories(categories)

    if args.learn:
        directory = args.config or CONFIG_DIR
        loaded = load_categories_config(directory)
        paths = args.paths or cached_category_paths()
        if not paths:
            print("\nNo DigiKey category paths to learn "
                  "(pass PATH arguments, or cache some products first).")
        elif not _prompt.interactive() and not args.paths:
            print("\n--learn needs a terminal, or explicit PATH arguments.")
            return 2
        else:
            print("\nLearning category aliases")
            chooser = _choose if _prompt.interactive() else None
            if chooser is None:
                print("  not a terminal - unmapped paths will be listed, "
                      "not written.")
            learned = learn_aliases(paths, loaded, directory, choose=chooser)
            unmapped = [p for p in paths
                        if p not in {a for a, _ in learned}
                        and not any(p in c.aliases for c in loaded.values())]
            if learned:
                for path, dest in learned:
                    print(f"  + {path} -> {dest}")
            if unmapped:
                print(f"  {len(unmapped)} path(s) still unmapped:")
                for path in unmapped:
                    print(f"    ? {path}")
            if not learned and not unmapped:
                print("  every path already has an alias")
            if learned and args.write:
                print("\nCreating new categories on the server")
                _, _, created = sync_tree(args.config, api, write=True)
                report_categories(created)

    if not args.write:
        print("\nDRY RUN complete - re-run with --write to apply server "
              "changes.")
    return 0

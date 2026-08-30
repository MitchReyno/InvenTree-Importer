#!/usr/bin/env python
"""
Delete every part, supplier part, manufacturer part, purchase order and stock
item from InvenTree, leaving the structure that describes them.

    uv run scripts/wipe-inventory.py                  # dry run: what would go
    uv run scripts/wipe-inventory.py --write          # do it, backing up first
    uv run scripts/wipe-inventory.py --write --yes    # no confirmation prompt

For starting the import over. Categories, companies, parameter templates,
custom units and stock locations are **kept** - they are the configuration you
built up, not the data you loaded with it.

    kept      part categories, companies (suppliers and manufacturers),
              parameter templates, custom units, stock locations
    deleted   stock items, purchase orders and their line items,
              supplier parts, manufacturer parts, parts

Deletion order matters, because InvenTree refuses to remove a record something
else still points at: stock, then purchase orders, then supplier and
manufacturer parts, then the parts themselves. Order line items are not deleted
directly - they go with their order, and asking for them first earns a 404. A
part also has to be marked inactive before it can be deleted at all.

Two things this checks before touching anything:

  * Build orders, BOM items and sales orders reference parts and are not
    deleted here. If any exist the script stops, because a half-finished wipe
    is worse than none.
  * A database backup is taken first, via `docker exec ... pg_dump`. There is
    no undo through the API. Use --no-backup only if you have one already.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from invimport.env import load_env_file  # noqa: E402

LIST_LIMIT = 1000

# What gets deleted, in the order it has to happen. Purchase orders go before
# supplier parts because a line item points at one; deleting the order takes
# its line items with it, so they are not listed here - only checked after.
TARGETS = [
    ("stock items", "stock/"),
    ("purchase orders", "order/po/"),
    ("supplier parts", "company/part/"),
    ("manufacturer parts", "company/part/manufacturer/"),
    ("parts", "part/"),
]

# Removed as a side effect of the above. Counted at the end rather than deleted
# directly: deleting them first fails with a 404 once their order has gone.
CASCADED = [("purchase order lines", "order/po-line/")]

# Things that point at parts and are not ours to remove. Any of these means
# stopping: deleting the parts underneath them would fail part-way through.
BLOCKERS = [
    ("build orders", "build/"),
    ("BOM items", "bom/"),
    ("sales orders", "order/so/"),
]

# Kept, and reported so it is obvious they were spared rather than missed.
KEPT = [
    ("part categories", "part/category/"),
    ("companies", "company/"),
    ("parameter templates", "parameter/template/"),
    ("custom units", "units/"),
    ("stock locations", "stock/location/"),
]


def count(api, endpoint: str) -> int:
    return int(api.get(endpoint, params={"limit": 1})["count"])


def pks(api, endpoint: str) -> list[int]:
    """Every pk at an endpoint, paged until exhausted."""
    found: list[int] = []
    offset = 0
    while True:
        page = api.get(endpoint, params={"limit": LIST_LIMIT, "offset": offset})
        rows = page.get("results") or []
        found.extend(int(row["pk"]) for row in rows if "pk" in row)
        if not page.get("next") or not rows:
            break
        offset += len(rows)
    return found


def backup(container: str, database: str, user: str, out_dir: Path) -> Path:
    """pg_dump the database. Raises if it cannot, because it is the only undo."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = out_dir / f"inventree-before-wipe-{stamp}.dump"
    command = ["docker", "exec", container, "pg_dump", "-U", user,
               "-d", database, "-Fc"]
    with path.open("wb") as handle:
        result = subprocess.run(command, stdout=handle, stderr=subprocess.PIPE)
    if result.returncode != 0:
        path.unlink(missing_ok=True)
        raise RuntimeError(
            f"backup failed ({' '.join(command)}):\n"
            f"{result.stderr.decode(errors='replace').strip()}\n"
            f"Pass --no-backup only if you already have one.")
    return path


def _reason(exc: Exception) -> str:
    """The server's message, not the wrapper's - the wrapper says nothing."""
    detail = exc.args[0] if exc.args else exc
    if isinstance(detail, dict):
        return f"{detail.get('status_code', '?')} {detail.get('body', '')}"[:160]
    return str(detail)[:160]


def delete_all(api, label: str, endpoint: str, *, write: bool) -> tuple[int, int]:
    """Delete everything at one endpoint. Returns (deleted, failed)."""
    targets = pks(api, endpoint)
    if not targets:
        print(f"  {label:<24} none")
        return 0, 0
    if not write:
        print(f"  {label:<24} {len(targets)} would go")
        return len(targets), 0

    deleted = gone = failed = 0
    for pk in targets:
        try:
            api.delete(f"{endpoint}{pk}/")
            deleted += 1
        except Exception as exc:
            if "404" in str(exc):
                # Already removed, most likely by a cascade from something
                # deleted earlier. The goal is met either way.
                gone += 1
                continue
            # A part still marked active is refused; deactivate and retry once.
            if endpoint == "part/":
                try:
                    api.patch(f"part/{pk}/", {"active": False})
                    api.delete(f"part/{pk}/")
                    deleted += 1
                    continue
                except Exception as retry:
                    exc = retry
            failed += 1
            print(f"    ! {label[:-1]} {pk}: {_reason(exc)}")
    summary = f"{deleted} deleted"
    if gone:
        summary += f", {gone} already gone"
    if failed:
        summary += f", {failed} FAILED"
    print(f"  {label:<24} {summary}")
    return deleted, failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true",
                        help="actually delete (default is a dry run)")
    parser.add_argument("--yes", action="store_true",
                        help="skip the typed confirmation")
    parser.add_argument("--no-backup", action="store_true",
                        help="do not pg_dump first - only if you have one")
    parser.add_argument("--backup-dir", type=Path,
                        default=REPO / "backups", metavar="DIR")
    parser.add_argument("--container", default="inventree-db",
                        help="docker container running postgres")
    parser.add_argument("--database", default="inventree")
    parser.add_argument("--db-user", default="inventree-user")
    parser.add_argument("--env-file", type=Path, default=REPO / ".env")
    args = parser.parse_args()

    load_env_file(args.env_file)
    from invimport.inventree.api import connect

    api = connect()

    blocked = [(label, count(api, endpoint)) for label, endpoint in BLOCKERS]
    standing = [(label, n) for label, n in blocked if n]
    if standing:
        print("Refusing to run: these reference parts and are not deleted here.")
        for label, n in standing:
            print(f"  {label:<24} {n}")
        print("Remove them first, or the wipe would fail part-way through.")
        return 2

    print(f"{'Would delete' if not args.write else 'Deleting'}:")
    totals = {label: count(api, endpoint) for label, endpoint in TARGETS}
    for label, _ in TARGETS:
        print(f"  {label:<24} {totals[label]}")
    for label, endpoint in CASCADED:
        totals[label] = count(api, endpoint)
        print(f"  {label:<24} {totals[label]} (with their order)")
    if not any(totals.values()):
        print("\nNothing to delete.")
        return 0

    print("\nKeeping:")
    for label, endpoint in KEPT:
        try:
            print(f"  {label:<24} {count(api, endpoint)}")
        except Exception:
            print(f"  {label:<24} ?")

    if not args.write:
        print("\nDry run. Re-run with --write to delete.")
        return 0

    if not args.yes:
        if not sys.stdin.isatty():
            print("\nRefusing to delete unattended without --yes.",
                  file=sys.stderr)
            return 2
        print(f"\nThis cannot be undone through the API.")
        if input('Type "delete" to continue: ').strip() != "delete":
            print("Stopped.")
            return 1

    if not args.no_backup:
        path = backup(args.container, args.database, args.db_user,
                      args.backup_dir)
        size = path.stat().st_size / 1024
        print(f"\nBacked up to {path} ({size:.0f} KB)")
        print("Restore with: docker exec -i "
              f"{args.container} pg_restore -U {args.db_user} "
              f"-d {args.database} --clean < {path.name}")

    print()
    failures = 0
    for label, endpoint in TARGETS:
        _, failed = delete_all(api, label, endpoint, write=True)
        failures += failed

    print("\nRemaining:")
    left = 0
    for label, endpoint in TARGETS + CASCADED:
        remaining = count(api, endpoint)
        left += remaining
        print(f"  {label:<24} {remaining}")
    if left:
        failures += left

    if failures:
        print(f"\n{failures} record(s) could not be deleted - see above.")
        return 1
    print("\nDone. Categories, companies, templates, units and locations kept.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Create and validate positively owned synthetic workspaces without replacing files."""
from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

from .state import DemoState

MARKER = "invimport-demo.json"
FORMAT = "invimport-demo/1"


def save_json(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            temporary.chmod(0o600)
            json.dump(value, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def load_workspace(path: Path) -> tuple[Path, dict]:
    path = path.absolute()
    if path.is_symlink():
        raise ValueError("demo workspace must be a real directory")
    path = path.resolve()
    manifest = json.loads((path / MARKER).read_text(encoding="utf-8"))
    if (not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("scenario") not in {"happy", "partial"}
            or not isinstance(manifest.get("instance"), str) or len(manifest["instance"]) != 32
            or type(manifest.get("port")) is not int or not 0 <= manifest["port"] <= 65535):
        raise ValueError("unrecognized demo workspace manifest")
    for child in (MARKER, "server.sqlite3", "source", "config", "output", "state", "home", "demo.env"):
        candidate = path / child
        if candidate.is_symlink() or not candidate.exists():
            raise ValueError(f"missing or symlinked owned demo member: {child}; never recreate lost state")
    state = DemoState(path / "server.sqlite3")
    state.validate_schema()
    with state.connect() as connection:
        instance = connection.execute("SELECT instance FROM identity").fetchall()
    if instance != [(manifest["instance"],)]:
        raise ValueError("demo manifest/database identity differs")
    return path, manifest


def create_workspace(path: Path, scenario: str) -> tuple[Path, dict]:
    if scenario not in {"happy", "partial"}:
        raise ValueError("unsupported demo scenario")
    path = path.absolute()
    if path.is_symlink() or path.exists():
        raise ValueError("new demo workspace must not exist")
    path = path.resolve()
    path.mkdir(mode=0o700)
    # Failure leaves an owned partial directory for inspection; never deletes/reseeds it.
    for name in ("source", "config", "output", "state", "home"):
        (path / name).mkdir(mode=0o700)
    manifest = {"format": FORMAT, "instance": uuid4().hex, "port": 0, "scenario": scenario}
    state = DemoState(path / "server.sqlite3")
    state.initialize(partial=scenario == "partial")
    with state.connect() as connection:
        connection.execute("CREATE TABLE identity(instance TEXT NOT NULL)")
        connection.execute("INSERT INTO identity VALUES (?)", (manifest["instance"],))
    (path / "demo.env").write_text("# DEMO ONLY. The runner pins fake credentials explicitly.\n", encoding="utf-8")
    (path / "demo.env").chmod(0o600)
    config = path / "config"
    (config / "categories.yaml").write_text("""Demo Resistors:
  identity: spec
  ipn_prefix: DEMO
  aliases: [Demo Resistors]
  key_parameters: [Resistance, Tolerance]
  parameters: [Resistance, Tolerance]
  name: "DEMO resistor {Resistance} ohm {Tolerance} percent"
""", encoding="utf-8")
    (config / "parameters.yaml").write_text("Resistance: {}\nTolerance: {}\n", encoding="utf-8")
    source = path / "source"
    (source / "synthetic-label.txt").write_text("SYNTHETIC DEMO EVIDENCE\nTwo fictional lots; no real purchase or component provenance.\n", encoding="utf-8")
    save_json(source / "stock.json", {
        "version": 2, "source": {"reference": "DEMO-" + manifest["instance"]},
        "defaults": {"supplier": "DEMO Supplier", "location": "DEMO Shelf",
                     "currency": "AUD", "order": {"reference": "DEMO-INVOICE"}},
        "parts": [{"id": "shared-resistor", "category": "Demo Resistors", "description": "Synthetic demo component",
                   "parameters": {"Resistance": "100", "Tolerance": "5"},
                   "attachments": [{"file": "synthetic-label.txt", "comment": "SYNTHETIC DEMO label"}]}],
        "lines": [{"id": "lot-a", "part": "shared-resistor", "quantity": 10, "batch": "DEMO-A", "sku": "DEMO-R100", "unit_price": "0.10"},
                  {"id": "lot-b", "part": "shared-resistor", "quantity": 20, "batch": "DEMO-B", "sku": "DEMO-R100", "unit_price": "0.20"}]})
    for directory in (source, config):
        for child in directory.iterdir():
            child.chmod(0o600)
    save_json(path / MARKER, manifest)
    return path, manifest

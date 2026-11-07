"""Run with the backend environment: offline real-importer acceptance, never apply."""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path

from invimport.config import load_categories_config, load_parameters_config
from invimport.stockfile import parse_document
from invimport.validate import validate

from runtime import FIXTURE, RunStore, decode_json, evidence_bytes


def validate_fixture_proposal(proposal: Path) -> dict:
    if any(parent.is_symlink() for parent in [proposal, *proposal.parents]):
        raise ValueError("symlink proposal")
    # Refuse final-component symlink substitution at open as well. Parse and hash
    # this one snapshot: importer validation must not reopen a mutable pathname.
    descriptor = os.open(proposal, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as source:
        data = source.read()
    raw = decode_json(data.decode("utf-8"))
    if set(raw) - {"version", "source", "defaults", "parts", "lines"}:
        raise ValueError("unsupported fixture proposal fields")
    if raw.get("version") != 2 or raw.get("source", {}).get("reference") != "SPIKE-TWO-LOTS-001":
        raise ValueError("changed source identity")
    if len(raw.get("parts", [])) != 1 or len(raw.get("lines", [])) != 2:
        raise ValueError("wrong Part/lot count")
    part = raw["parts"][0]
    if set(part) != {"id", "category", "parameters"} or part["id"] != "resistor-100r":
        raise ValueError("unexpected Part identity or invented manufacturer")
    manifest = decode_json((FIXTURE / "input-confirmed.json").read_text(encoding="utf-8"))
    expected_part = {key: manifest["parts"][0][key] for key in ("id", "category", "parameters")}
    if part != expected_part or raw.get("defaults") != manifest["defaults"]:
        raise ValueError("changed fixture facts")
    for reference in manifest["evidence"]:
        evidence_bytes(proposal.parent, reference)
    for line, lot, image in zip(raw["lines"], manifest["lots"], ["packet-a", "packet-b"], strict=True):
        if set(line) != {"id", "part", "quantity", "batch", "stock_images"}:
            raise ValueError("unsupported lot fields")
        if (line["id"], line["part"], str(line["quantity"]), line["batch"], line["stock_images"]) != (
                lot["id"], lot["part_id"], lot["quantity"], lot["batch"], [f"evidence/{image}.png"]):
            raise ValueError("changed contribution or unsupported evidence")
    document = parse_document(raw, path=proposal)
    config = FIXTURE / "config"
    report = validate(document, load_categories_config(config), load_parameters_config(config))
    if not report.ok:
        raise ValueError(report.text())
    return {"ok": True, "validation_report": report.text(), "proposal_sha256": sha256(data).hexdigest(),
            "keys": [document.key_for(line) for line in document.lines]}


def accept(directory: Path) -> dict:
    proposal = directory / "bundle/proposal.json"
    report = validate_fixture_proposal(proposal)
    store = RunStore(directory / "questions.sqlite3")
    try:
        requests = [decode_json(row[0]) for row in store.db.execute("SELECT payload FROM events ORDER BY id")]
        request = next(message for message in requests if message["type"] == "job.request" and message["attempt_id"] == "attempt-2")
        confirmed = (FIXTURE / "input-confirmed.json").read_bytes()
        if request["input_revision"] != sha256(confirmed).hexdigest():
            raise ValueError("stale proposal input")
        if (directory / "bundle/input-confirmed.json").read_bytes() != confirmed:
            raise ValueError("changed confirmed manifest")
        answered = store.db.execute("SELECT answer FROM questions WHERE id='count-lot-b'").fetchone()
        if answered is None or answered[0] is None:
            raise ValueError("missing durable human answer")
        answer = decode_json(answered[0])
        if answer["value"] != "20" or answer["actor_id"] != "fixture-user":
            raise ValueError("invalid fixture answer")
        emitted = [message for message in requests if message["attempt_id"] == "attempt-2" and "sequence" in message]
        if any(message["type"] == "job.result" for message in emitted):
            raise ValueError("attempt already terminal")
        context = {key: request[key] for key in ("protocol_version", "batch_id", "job_id", "attempt_id", "input_revision")}
        store.append(context | {"type": "job.result", "sequence": max(message["sequence"] for message in emitted) + 1,
                     "status": "succeeded", "output_ref": {"path": "proposal.json", "sha256": report["proposal_sha256"],
                     "media_type": "application/json"}})
        messages = [row[0] for row in store.db.execute("SELECT payload FROM events ORDER BY id")]
        (directory / "messages.jsonl").write_text("\n".join(messages) + "\n", encoding="utf-8")
        (directory / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report
    finally:
        store.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    print(json.dumps(accept(parser.parse_args().directory), indent=2))

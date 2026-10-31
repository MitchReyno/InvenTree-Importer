"""Visible local artifact operations and immutable, content-verified uploads.

Source content and logical targets are frozen before execution. Run state never
enters its own evidence archive. Artifact uploads do not change packaged bytes.
"""
from __future__ import annotations

from base64 import b64decode, b64encode
from dataclasses import asdict, replace
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
from threading import Event
from typing import TYPE_CHECKING

from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from ..stockfile import StockFile
from .executor import OperationContext, _dependency_settled, _failed
from .dispatch import guarded
from .observation import durable_correlation
from .store import RunStore
from .models import (Attribution, Certainty, Effect, Inputs, Kind, OperationResult,
                     OperationSpec, Plan, State, canonical, digest, validate_plan)
from .ownership import JournalError
from .stock_api import StockRequests

if TYPE_CHECKING:
    from .stock_handlers import StockHandlers

FINAL_ACTIONS = {"provenance_snapshot", "evidence_archive", "artifact_upload", "outcome_report"}


def artifact_path(directory: Path, operation: str, suffix: str = ".bin") -> Path:
    return directory / "artifacts" / (digest(operation) + suffix)


def save_immutable(path: Path, content: bytes, context: OperationContext) -> None:
    """A failed local effect poisons this run; never continue remote mutations."""
    context.check()
    try:
        if path.exists():
            if path.read_bytes() != content:
                raise JournalError("retained artifact differs from its approved content")
            return
        temporary = path.with_suffix(path.suffix + ".tmp")
        with temporary.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o600)
        temporary.replace(path)
    except OSError as exc:
        context.store.healthy = False
        raise JournalError("local artifact persistence failed; mutations stopped") from exc


def retained_hash(context: OperationContext, operation: str) -> str | None:
    receipts = prepared_artifacts(context.store, operation)
    return receipts[-1]["sha256"] if receipts else None


def prepared_artifacts(store: RunStore, operation: str) -> list[dict]:
    rows = store.connection.execute(
        "SELECT safe_json FROM events WHERE operation=? AND kind='artifact_prepared' ORDER BY sequence", (operation,)).fetchall()
    return [json.loads(row[0]) for row in rows]


def prepared_path(store: RunStore, receipt: dict, operation: str) -> Path:
    filename = receipt.get("filename")
    if filename is None:
        return artifact_path(store.path.parent, operation)
    if Path(filename).name != filename:
        raise JournalError("invalid retained artifact path")
    return store.path.parent / "artifacts" / filename


def effect_fingerprint(store: RunStore) -> str:
    return digest(_changes(store))


def frozen_sources(document: StockFile) -> list[dict[str, str]]:
    from ..inventree.archive import archive_files, import_folder
    from .stock_assets import stable_bytes
    folder, _ = import_folder(document)
    if folder is None:
        return []
    excluded_names = {"PLAN.json", "plan.json", "partial-report.json", "execution-report.json",
                      "invimport-source-manifest.json", "invimport-confirmed-changes.json"}
    excluded_dirs = {"artifacts", "montage", "montages", "downloads", "report-images"}
    manifest = []
    for path in archive_files(folder):
        relative = path.relative_to(folder)
        if path.name in excluded_names or excluded_dirs.intersection(relative.parts):
            continue
        if path.name.endswith((".provenance.json", "-wal", "-shm", "-journal")) or path.suffix.lower() == ".zip":
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(folder.resolve()):
            raise ValueError("archive source escapes its import folder")
        content = stable_bytes(path)
        if path.suffix.lower() == ".json":
            try:
                decoded = json.loads(content)
            except (ValueError, UnicodeDecodeError):
                decoded = None
            documents = decoded if isinstance(decoded, list) else [decoded]
            if any(isinstance(item, dict) and ("plan_version" in item or
                   item.get("format") == "invimport-execution-report/1" or
                   {"schema_version", "operations", "input_digest"}.issubset(item)) for item in documents):
                continue
        manifest.append({"name": relative.as_posix(), "sha256": sha256(content).hexdigest(),
                         "bytes": b64encode(content).decode("ascii")})
    return manifest


def with_finalization(plan: Plan, document: StockFile, *, archive: bool, provenance: bool) -> Plan:
    """Freeze the complete settled graph, manifest, source claims and upload scope."""
    operations = list(plan.operations)
    settled = [op.id for op in operations]
    attribution = Attribution(plan.import_id, tuple(line.id for line in document.lines))
    def add(action: str, payload: dict, after: list[str]) -> OperationSpec:
        operation = OperationSpec.build(Kind.EVIDENCE, "finalization:" + plan.import_id,
            discriminator=action + ":" + str(payload.get("target", "")) + ":" + str(payload.get("role", "")),
            desired=Inputs.freeze({"action": action, **payload}), settled_after=tuple(after),
            provides=("record",) if action == "artifact_upload" else (), attribution=attribution, reconciliation="stock_v1")
        operations.append(operation)
        return operation
    provenance_op = None
    if provenance:
        source_rows = {line.id: {"line": line.provenance, "part": line.part_provenance,
                                "manufacturer_part": line.manufacturer_part_provenance} for line in document.lines}
        provenance_op = add("provenance_snapshot", {"sources": source_rows, "source": document.source}, settled)
    archive_op = None
    if archive:
        manifest = frozen_sources(document)
        sources = {Path(item["name"]).name: item["sha256"] for item in manifest}
        for operation in plan.operations:
            desired = operation.desired.values()
            if desired.get("action") == "asset_stage" and desired["filename"] in sources and sources[desired["filename"]] != desired["sha256"]:
                raise ValueError("requested source changed between asset and archive preparation")
        archive_op = add("evidence_archive", {"manifest": manifest,
                         "provenance": provenance_op.id if provenance_op else None},
                         settled + ([provenance_op.id] if provenance_op else []))
    targets = [op for op in plan.operations if op.desired.values().get("action") == "order"]
    if not targets:
        targets = [op for op in plan.operations if op.kind == Kind.COMPANY and op.desired.values()["payload"].get("is_supplier")]
    if archive_op:
        for target in targets:
            add("artifact_upload", {"target": target.id, "artifact": archive_op.id, "role": "archive"}, [archive_op.id])
    if provenance_op:
        records = [op for op in plan.operations if op.kind in {Kind.PART, Kind.COMPANY, Kind.STOCK}
                   or op.desired.values().get("action") in {"supplier_part", "manufacturer_part", "order"}]
        for target in records:
            add("artifact_upload", {"target": target.id, "artifact": provenance_op.id, "role": "provenance"},
                [provenance_op.id] + ([archive_op.id] if archive_op else []))
    add("outcome_report", {}, [op.id for op in operations])
    result = replace(plan, operations=tuple(operations), schema_version=2)
    validate_plan(result)
    return result


def _changes(store: RunStore) -> list[dict]:
    """A failed line's confirmed effects remain attributable; no requested fact becomes a change."""
    changes = []
    results = store.results()
    observed = {}
    for operation_id, payload in store.connection.execute(
            "SELECT operation,safe_json FROM events WHERE kind='confirmed_mutation_fields' ORDER BY sequence"):
        receipt = json.loads(payload)
        observed[(operation_id, receipt["effect_kind"], receipt["model"], receipt["pk"])] = receipt["fields"]
    for operation in store.plan.operations:
        if operation.desired.values().get("action") in FINAL_ACTIONS | {"asset_stage", "asset_extract"}:
            continue
        result = results.get(operation.id)
        if result is None:
            continue
        effects = result.effects
        if result.certainty == Certainty.UNKNOWN and not any(effect.certainty == Certainty.UNKNOWN for effect in effects):
            effects = (*effects, Effect("unresolved_attempt", Certainty.UNKNOWN))
        for effect in effects:
            desired = operation.desired.values()
            facts = observed.get((operation.id, effect.kind, effect.model, effect.pk), {}) if effect.certainty == Certainty.CONFIRMED else {}
            if (effect.kind == "barcode" and result.state in {State.SUCCEEDED, State.ALREADY_SATISFIED}
                    and effect.certainty == Certainty.CONFIRMED):
                facts = {"barcode": desired["key"]}
            if effect.kind == "upload" and effect.certainty == Certainty.CONFIRMED:
                facts = {key: desired[key] for key in ("filename", "sha256") if key in desired}
            changes.append({"operation": operation.id, "source": operation.attribution.source,
                            "lines": list(operation.attribution.lines), "kind": effect.kind,
                            "model": effect.model, "pk": effect.pk, "certainty": effect.certainty.value,
                            "confirmed_fields": facts})
    return changes


def _provenance(spec: OperationSpec, context: OperationContext) -> bytes | None:
    desired = spec.desired.values()
    changes = _changes(context.store)
    if not changes:
        return None
    return canonical({"format": "invimport-execution-provenance/1", "import_id": context.store.plan.import_id,
                      "revision": context.store.plan.revision, "run_id": context.store.run_id,
                      "effect_set": effect_fingerprint(context.store),
                      "changes": changes,
                      "source_claims": desired["sources"], "source": desired["source"],
                      "claims_policy": "Source claims are evidence, not a statement that each fact was written."}).encode()


def _archive(spec: OperationSpec, context: OperationContext) -> bytes | None:
    desired = spec.desired.values()
    changes = _changes(context.store)
    if not any(change["certainty"] == "confirmed" and change["kind"] != "asset_stage" for change in changes):
        return None
    entries = {}
    for item in desired["manifest"]:
        content = b64decode(item["bytes"], validate=True)
        if sha256(content).hexdigest() != item["sha256"]:
            raise JournalError("frozen source manifest content mismatch")
        entries[item["name"]] = content
    manifest = [{"name": item["name"], "sha256": item["sha256"]} for item in desired["manifest"]]
    entries["invimport-source-manifest.json"] = canonical(manifest).encode()
    if desired["provenance"]:
        receipts = prepared_artifacts(context.store, desired["provenance"])
        if not receipts:
            return None
        path = prepared_path(context.store, receipts[-1], desired["provenance"])
        if not path.is_file():
            return None
        content = path.read_bytes()
        if retained_hash(context, desired["provenance"]) != sha256(content).hexdigest():
            raise JournalError("provenance artifact failed immutable identity check")
        entries["invimport-confirmed-changes.json"] = content
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in sorted(entries.items()):
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, content)
    return buffer.getvalue()


def _local_result(kind: str) -> OperationResult:
    return OperationResult(State.SUCCEEDED, Certainty.CONFIRMED, effects=(Effect(kind, Certainty.CONFIRMED),))


def run_local_or_final(spec: OperationSpec, context: OperationContext, api: StockRequests, *, repair: bool) -> OperationResult:
    from .stock_handlers import review
    desired = spec.desired.values()
    action = desired["action"]
    directory = context.store.path.parent
    path = artifact_path(directory, spec.id)
    if action == "artifact_upload":
        return _upload_versions(spec, context, api)
    fingerprint = effect_fingerprint(context.store)
    receipts = prepared_artifacts(context.store, spec.id)
    matching = [receipt for receipt in receipts if receipt.get("fingerprint") == fingerprint]
    if matching:
        saved = prepared_path(context.store, matching[-1], spec.id)
        if not saved.is_file() or sha256(saved.read_bytes()).hexdigest() != matching[-1]["sha256"]:
            return review("retained_artifact_missing_or_corrupt")
        return _local_result(action)
    if receipts:
        path = artifact_path(directory, spec.id, "-" + fingerprint + ".bin")
    if action == "outcome_report":
        from .stock_workflow import partial_report
        snapshot = context.store.snapshot()
        for item in snapshot["operations"]:
            if item["id"] == spec.id:
                item["state"] = State.SUCCEEDED
                item["result"] = asdict(_local_result(action))
        # This projection becomes true only when its atomic save succeeds.
        content = canonical(partial_report(context.store.plan, snapshot)).encode()
    elif path.exists():
        if retained_hash(context, spec.id) != sha256(path.read_bytes()).hexdigest():
            return review("retained_artifact_corrupt_or_uncheckpointed")
        return _local_result(action)
    elif action in {"asset_stage", "asset_extract"}:
        content = b64decode(desired["bytes"], validate=True)
        if action == "asset_extract":
            from .stock_assets import extract_pdf
            content = extract_pdf(content, desired["pages"])
        if sha256(content).hexdigest() != desired["sha256"]:
            return review("frozen_asset_corrupt")
    elif action == "provenance_snapshot":
        content = _provenance(spec, context)
        if content is None:
            return OperationResult(State.SKIPPED)
    elif action == "evidence_archive":
        content = _archive(spec, context)
        if content is None:
            return OperationResult(State.SKIPPED)
    else:
        raise ValueError("unknown local/final operation")
    save_immutable(path, content, context)
    with context.store.transaction() as connection:
        context.store._event(connection, "artifact_prepared", spec.id, context.attempt.id,
                             sha256=sha256(content).hexdigest(), size=len(content),
                             fingerprint=fingerprint, filename=path.name)
    return _local_result(action)


def _upload_versions(spec: OperationSpec, context: OperationContext, api: StockRequests) -> OperationResult:
    from .stock_evidence import ensure_evidence
    from .stock_handlers import _read, review
    desired = spec.desired.values()
    target_result = context.store.results().get(desired["target"])
    if target_result is None or not target_result.outputs:
        return OperationResult(State.SKIPPED)
    target = target_result.outputs[0]
    receipts = prepared_artifacts(context.store, desired["artifact"])
    artifact_result = context.store.results().get(desired["artifact"])
    if not receipts:
        return OperationResult(State.SKIPPED) if artifact_result and artifact_result.state == State.SKIPPED else review("retained_final_artifact_missing")
    result = OperationResult(State.SKIPPED)
    for receipt in receipts:
        artifact = prepared_path(context.store, receipt, desired["artifact"])
        if not artifact.is_file():
            return review("retained_final_artifact_missing")
        content = artifact.read_bytes()
        content_hash = sha256(content).hexdigest()
        if receipt["sha256"] != content_hash:
            return review("retained_final_artifact_corrupt")
        row = _read(api, target)
        if row is None:
            return review("artifact_target_identity_drift")
        filename = f"invimport-{desired['role']}-{content_hash[:20]}" + (".zip" if desired["role"] == "archive" else ".json")
        projected = replace(spec, desired=Inputs.freeze({"action": "evidence", "bytes": b64encode(content).decode("ascii"),
                           "sha256": content_hash, "filename": filename, "versioned": True}))
        result = ensure_evidence(projected, context, api, [(target, row)], repair=True)
        if result.state not in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED}:
            return result
    return result


def refresh_finalization(store: RunStore, handlers: StockHandlers, *, cancelled: Event | None) -> dict:
    """After explicit inventory repair, append immutable effect-set revisions.

    A no-op repair/resume creates no artifact revision. Old receipts and pending
    uploads retain their exact bytes, source scope and originating-run targets.
    """
    from requests import RequestException
    fingerprint = effect_fingerprint(store)
    final = [op for op in store.plan.operations if op.desired.values().get("action") in FINAL_ACTIONS]
    if not final:
        return store.snapshot()
    basis = next((op for op in final if op.desired.values()["action"] == "provenance_snapshot"), final[0])
    receipts = prepared_artifacts(store, basis.id)
    if receipts and receipts[-1].get("fingerprint") == fingerprint:
        return store.snapshot()
    cancelled = cancelled or Event()
    for spec in final:
        results, states = store.results(), store.states()
        outputs = {(key, output.name): output for key, result in results.items() for output in result.outputs}
        if not all(_dependency_settled(store.plan, parent, states, outputs) for parent in spec.settled_after):
            continue
        attempt = store.start_finalization_revision(spec.id, fingerprint)
        context = OperationContext(store, attempt, cancelled=cancelled, inputs=outputs)
        with durable_correlation(run=store.run_id, operation=spec.id, attempt=attempt.id,
                                 source=spec.attribution.source, group=spec.group), guarded(context):
            try:
                context.check()
                result = handlers.repair(spec, context)
                context.check()
            except JournalError:
                raise
            except (RequestException, ConnectionError, TimeoutError, InterruptedError) as exc:
                store.finish(attempt, _failed(exc, context))
            else:
                store.finish(attempt, result)
    return store.snapshot()

"""Legacy StockImportResult projection, with explicit artifact status adapters."""
from __future__ import annotations

from pathlib import Path

from ..inventree.archive import ArchiveTarget, ImportArchive
from ..inventree.companies import LogoAction
from ..inventree.stockimport import LineAction, ProvenanceOutcome, StockImportResult
from .models import Plan, State
from .artifacts import retained_artifact_status


def project_stock_result(plan: Plan, snapshot: dict, *, run_directory: Path | None = None) -> StockImportResult:
    """Legacy result/--plan adapter; detailed operation state remains authoritative."""
    from .stock_workflow import partial_report
    result = StockImportResult()
    rows = {row["id"]: row for row in snapshot["operations"]}
    projected = partial_report(plan, snapshot)
    inputs = plan.decisions.values().get("line_inputs", {})
    models = {"part.part": "part", "company.manufacturerpart": "manufacturer_part",
              "company.supplierpart": "supplier_part", "order.purchaseorder": "purchase_order",
              "stock.stockitem": "stock_item"}
    for line in projected["lines"]:
        source = inputs.get(line["line"], {})
        action = LineAction(line["line"], quantity=source.get("quantity", 0),
                            category=source.get("category", ""), location=source.get("location", ""),
                            part_of=source.get("part_of", ""), supplier_name=source.get("supplier", ""),
                            order_reference=source.get("order", {}).get("reference", ""))
        created_stock = False
        for operation in plan.operations:
            if line["line"] not in operation.attribution.lines:
                continue
            settled = rows[operation.id]["result"]
            if not settled:
                continue
            for output in settled["outputs"]:
                field = models.get(output["model"])
                if field:
                    setattr(action, field, output["pk"])
                elif output["model"] == "company.company" and operation.desired.values().get("payload", {}).get("is_supplier"):
                    action.supplier = output["pk"]
            if operation.kind.value == "part":
                payload = operation.desired.values()["payload"]
                action.name, action.ipn = payload.get("name", ""), payload.get("IPN", "")
                if source.get("name") and source["name"] != action.name:
                    action.name_kept = f"the part is already called {action.name!r}"
            desired = operation.desired.values()
            if desired.get("action") == "notes" and operation.requires:
                parent = next(op for op in plan.operations if op.id == operation.requires[0].operation)
                field = {"part": "part_notes", "manufacturer_part": "manufacturer_part_notes"}.get(parent.desired.values().get("action"))
                if field and rows[operation.id]["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED}:
                    outcome = "written" if any(effect["kind"] == "notes" for effect in settled["effects"]) else "kept - the record already has notes"
                    setattr(action, field, outcome)
            if desired.get("action") == "evidence" and desired.get("comment", "").startswith("Datasheet"):
                if rows[operation.id]["state"] in {State.SUCCEEDED, State.ALREADY_SATISFIED}:
                    action.datasheet = ", ".join(filter(None, [action.datasheet, desired["filename"]]))
                else:
                    action.datasheet_problem = "requested datasheet is incomplete"
            if desired.get("action") == "parameter" and any(effect["kind"] == "create" for effect in settled["effects"]):
                owner = next(op for op in plan.operations if op.id == operation.requires[0].operation)
                if owner.desired.values().get("action") in {"part", "manufacturer_part"}:
                    action.parameters += 1
            if operation.desired.values().get("action") == "stock":
                created_stock = any(effect["kind"] == "create" for effect in settled["effects"])
        action.action = ("created" if created_stock else "exists") if line["registered"] else "review"
        disposition = next((op.desired.values() for op in plan.operations if line["line"] in op.attribution.lines
                            and op.desired.values().get("action") == "line_disposition"), None)
        if disposition:
            action.action = "skipped" if disposition["outcome"] == "skip" else "review"
            action.reason = disposition["reason"]
        if not line["complete"]:
            action.reason = "requested work is incomplete; inspect the execution report"
            result.problems.append(f"line {action.id}: {action.reason}")
        result.lines.append(action)
    _project_artifacts(plan, snapshot, result, run_directory)
    return result


def _attachment_outcome(row: dict) -> str:
    if row['state'] == State.UNCERTAIN:
        return 'unknown'
    if row['state'] == State.SUCCEEDED:
        return 'attached'
    if row['state'] == State.ALREADY_SATISFIED:
        return 'already attached'
    return 'failed'


def _project_artifacts(plan: Plan, snapshot: dict, result: StockImportResult, directory: Path | None) -> None:
    operations = {operation.id: operation for operation in plan.operations}
    rows = {row['id']: row for row in snapshot['operations']}
    receipts = snapshot.get('prepared_artifacts', [])
    archives = [operation for operation in plan.operations if operation.desired.values().get('action') == 'evidence_archive']
    if archives:
        operation = archives[0]
        prepared = [receipt for receipt in receipts if receipt['operation'] == operation.id]
        archive = ImportArchive(files=[item['name'] for item in operation.desired.values()['manifest']],
                                unattached=list(operation.desired.values().get("inapplicable_lines", [])))
        if prepared:
            latest = prepared[-1]
            archive.digest, archive.size = latest['sha256'], latest['size']
            archive.name = f"invimport-archive-{archive.digest[:20]}.zip"
            if directory:
                status = retained_artifact_status(directory, latest)
                if status != "verified":
                    archive.reason = f"retained archive file is {status}; remote transfer history is unchanged"
        else:
            archive.reason = 'no confirmed inventory changes or applicable prepared source archive'
        result.archive = archive
    provenance = next((operation for operation in plan.operations if operation.desired.values().get('action') == 'provenance_snapshot'), None)
    if provenance:
        prepared = [receipt for receipt in receipts if receipt['operation'] == provenance.id]
        result.provenance = ProvenanceOutcome()
        if prepared and directory:
            path = directory / 'artifacts' / prepared[-1]['filename']
            status = retained_artifact_status(directory, prepared[-1])
            if status == "verified":
                result.provenance.file = path
            else:
                result.provenance.reason = f"retained provenance file is {status}"
        elif not prepared:
            result.provenance.reason = 'no confirmed changes or unresolved effects to record'
    for operation in plan.operations:
        desired = operation.desired.values()
        if desired.get('action') == 'evidence' and desired.get('only_created'):
            creator = operations[operation.requires[0].operation]
            outputs = (rows[creator.id]['result'] or {}).get('outputs', [])
            company = creator.desired.values()['payload']['name']
            state = rows[operation.id]['state']
            outcome = 'set' if state in {State.SUCCEEDED, State.ALREADY_SATISFIED} else (
                'on the server - left alone' if state == State.SKIPPED else 'failed')
            result.logos.append(LogoAction(company, outcome, image=desired['filename'], company=company,
                                           pk=outputs[0]['pk'] if outputs else None))
        if desired.get('action') != 'artifact_upload':
            continue
        selection = next((item for item in snapshot.get("artifact_targets", []) if item["operation"] == operation.id), None)
        target = operations[selection["target_operation"] if selection else desired["target"]]
        outputs = (rows[operation.id]['result'] or {}).get('outputs', []) or (rows[target.id]['result'] or {}).get('outputs', [])
        if not outputs or rows[operation.id]['state'] == State.SKIPPED:
            if desired['role'] == 'archive' and result.archive:
                result.archive.unattached.extend(operation.attribution.lines)
            continue
        output = outputs[0]
        outcome = _attachment_outcome(rows[operation.id])
        if desired['role'] == 'archive' and result.archive:
            kind = 'purchase order' if output['model'] == 'order.purchaseorder' else 'supplier'
            result.archive.targets.append(ArchiveTarget(kind, output['pk'], target.subject,
                                                       list(operation.attribution.lines), outcome=outcome))
        elif desired['role'] == 'provenance' and result.provenance:
            field = {'attached': 'attached', 'already attached': 'already_satisfied',
                     'unknown': 'unknown', 'failed': 'failed'}[outcome]
            getattr(result.provenance, field).append((output['model'], output['pk'], 'Import provenance'))
    if result.archive:
        deduplicated = {}
        priorities = {"unknown": 4, "failed": 3, "attached": 2, "already attached": 1}
        for target in result.archive.targets:
            key = (target.kind, target.pk)
            if key not in deduplicated:
                deduplicated[key] = target
                continue
            existing = deduplicated[key]
            existing.lines = list(dict.fromkeys([*existing.lines, *target.lines]))
            if priorities.get(target.outcome, 0) > priorities.get(existing.outcome, 0):
                existing.outcome = target.outcome
        result.archive.targets = list(deduplicated.values())

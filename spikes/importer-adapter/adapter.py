"""Repository-only fake-target experiment; not a web API or authorization service."""
from __future__ import annotations

from base64 import b64decode
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import shutil

from jsonschema import Draft202012Validator

from invimport.config import load_config
from invimport.demo.runner import verify_server, endpoint
from invimport.demo.workspace import create_workspace, load_workspace, save_json
from invimport.execution.adoption import inspect_binding
from invimport.execution.models import Plan, Target, canonical
from invimport.execution.observation import active
from invimport.execution.ownership import FileLock, JournalError, normalize_endpoint, state_root
from invimport.execution.stock_workflow import execute_stock, prepare_full_stock
from invimport.inventree.api import client
from invimport.inventree.stockimport import ImportOptions
from invimport.stockfile import read_file as read_stock
from invimport.validate import validate as validate_stock

from questions import Questions

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "spikes/shared/fixtures/two-lots"


def read_json(path: Path) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    def invalid(_value):
        raise ValueError("nonfinite JSON")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique, parse_constant=invalid)


def validate_message(message: dict) -> None:
    schema = read_json(ROOT / "spikes/shared/schemas/message.schema.json")
    Draft202012Validator(schema).validate(message)


def build_digest() -> str:
    """Bind actual importer/adapter source bytes, not a mutable version label."""
    files = sorted((ROOT / "backend/src/invimport").rglob("*.py"))
    files += sorted(Path(__file__).parent.glob("*.py"))
    files += [ROOT / "backend/pyproject.toml", ROOT / "backend/uv.lock"]
    return sha256(canonical([(str(p.relative_to(ROOT)), sha256(p.read_bytes()).hexdigest()) for p in files]).encode()).hexdigest()


def initialize(path: Path, *, partial: bool = False) -> Path:
    path, _manifest = create_workspace(path, "partial" if partial else "happy")
    # Only this newly-created synthetic workspace is modified. No existing demo
    # workspace, canonical state, namespace or consumed fault is ever reseeded.
    shutil.copytree(FIXTURE / "evidence", path / "source/evidence")
    shutil.copy2(FIXTURE / "expected-stock.json", path / "source/proposal.json")
    shutil.copy2(FIXTURE / "input-confirmed.json", path / "source/input.json")
    for config in (FIXTURE / "config").iterdir():
        shutil.copy2(config, path / "config" / config.name)
    (path / "intents").mkdir(mode=0o700)
    (path / "questions").mkdir(mode=0o700)
    return path


def fake_api(path: Path):
    path, manifest = load_workspace(path)
    verify_server(manifest)
    from invimport.demo.server import TOKEN
    return client(endpoint(manifest), token=TOKEN, observation=active()), Target(endpoint(manifest))


def question_context(path: Path) -> dict:
    return {"protocol_version": "bench-intake-spike/1", "batch_id": "batch-two-lots",
            "job_id": "prepare-two-lots", "attempt_id": "prepare-one",
            "input_revision": sha256((path / "source/input.json").read_bytes()).hexdigest()}


def materialize(proposal: dict, selected: list[str], *, known_ipn: str = "") -> dict:
    """Filter BEFORE v2 expansion, so part_of cannot import an unselected lot."""
    if proposal.get("version") != 2:
        raise ValueError("spike requires v2 shared Parts; v1 part_of needs explicit identity resolution")
    ids = [line["id"] for line in proposal["lines"]]
    if not selected or len(set(selected)) != len(selected) or not set(selected) <= set(ids):
        raise ValueError("invalid selected scope")
    value = json.loads(canonical(proposal))
    value["lines"] = [line for line in value["lines"] if line["id"] in selected]
    used = {line["part"] for line in value["lines"]}
    value["parts"] = [part for part in value["parts"] if part["id"] in used]
    if known_ipn:
        if len(value["parts"]) != 1:
            raise ValueError("known IPN only supports this one shared Part")
        value["parts"][0]["ipn"] = known_ipn
    return value


def prepare(path: Path, selected: list[str], *, known_part: tuple[int, str] | None = None) -> tuple[Plan, dict]:
    path, manifest = load_workspace(path)
    with FileLock(path / "prepare.lock"):
        api, target = fake_api(path)
        if known_part:
            row = api.get(f"part/{known_part[0]}/")
            if row["IPN"] != known_part[1]:
                raise ValueError("known shared Part drift")
        raw = materialize(read_json(path / "source/proposal.json"), selected,
                          known_ipn=known_part[1] if known_part else "")
        source = path / "source/selected.json"
        save_json(source, raw)
        document = read_stock(source)
        categories, parameters = load_config(path / "config")
        validation = validate_stock(document, categories, parameters)
        if not validation.ok:
            raise ValueError(validation.text())
        config_hashes = {p.name: sha256(p.read_bytes()).hexdigest() for p in sorted((path / "config").iterdir()) if p.is_file()}
        planning_revision = sha256(canonical([raw, config_hashes, asdict(target)]).encode()).hexdigest()
        questions = Questions(path / "questions", question_context(path), planning_revision=planning_revision)

        def company(name, candidates):
            offered = {str(row.pk): row for row, _score in candidates}
            offered["new"] = name
            return questions.choose("Supplier " + name, offered, selected, kind="evidence_clarification")

        def part(line, candidates):
            offered = {str(row.pk): row for row in candidates}
            offered["new"] = "new"
            return questions.choose("Part for " + line.id, offered, [line.id], kind="part_match")

        options = ImportOptions(archive=False, provenance=False, create_suppliers=False, choose_supplier=company,
                                choose_part=part, choose_name_match=part)
        plan = prepare_full_stock(document, categories=categories, parameters=parameters,
                                  target=target, api=api, options=options)
        if set(plan.decisions.values()["sources"]) != set(selected):
            raise ValueError("preparation expanded lot scope")
        if any(set(op.attribution.lines) - set(selected) for op in plan.operations):
            raise ValueError("unselected operation attribution")
        binding = {"format": "bench-intake-approval/1", "plan_revision": plan.revision,
                   "plan_sha256": sha256(plan.dumps().encode()).hexdigest(), "build": build_digest(),
                   "selected": selected, "source": raw["source"], "target": asdict(plan.target),
                   "fake_instance": manifest["instance"], "state_binding": "state",
                   "input_revision": question_context(path)["input_revision"],
                   "proposal_sha256": sha256((path / "source/proposal.json").read_bytes()).hexdigest(),
                   "config": config_hashes, "artifacts": artifact_hashes(plan),
                   "files": plan.files.values(), "known_part": list(known_part) if known_part else None}
        return plan, binding


def artifact_hashes(plan: Plan) -> dict:
    artifacts = {}
    for operation in plan.operations:
        desired = operation.desired.values()
        if "bytes" in desired:
            content_hash = sha256(b64decode(desired["bytes"], validate=True)).hexdigest()
            if desired.get("action") != "asset_extract" and content_hash != desired["sha256"]:
                raise ValueError("artifact byte/hash mismatch")
            artifacts[operation.id] = content_hash
    return artifacts


def approve(path: Path, plan: Plan, binding: dict, *, actor: str) -> str:
    """Explicit trusted human action, committed before any child dispatch."""
    if (not actor or binding["plan_revision"] != plan.revision or binding["build"] != build_digest()
            or binding["artifacts"] != artifact_hashes(plan)):
        raise ValueError("invalid/stale approval")
    if (binding["input_revision"] != question_context(path)["input_revision"]
            or binding["proposal_sha256"] != sha256((path / "source/proposal.json").read_bytes()).hexdigest()
            or binding["config"] != {p.name: sha256(p.read_bytes()).hexdigest() for p in sorted((path / "config").iterdir()) if p.is_file()}):
        raise ValueError("preparation inputs changed before approval")
    intent = {**binding, "actor": actor, "plan": plan.dumps()}
    key = sha256(canonical(intent).encode()).hexdigest()
    destination = path / "intents" / (key + ".json")
    if destination.exists():
        if read_json(destination) != intent:
            raise ValueError("intent collision")
    else:
        save_json(destination, intent)
    return key


def load_intent(path: Path, key: str) -> tuple[Plan, Path]:
    if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
        raise ValueError("invalid intent key")
    intent = read_json(path / "intents" / (key + ".json"))
    if sha256(canonical(intent).encode()).hexdigest() != key or intent["build"] != build_digest():
        raise ValueError("intent/build drift; compatible worker required")
    plan = Plan.loads(intent["plan"])
    if (plan.revision != intent["plan_revision"] or sha256(plan.dumps().encode()).hexdigest() != intent["plan_sha256"]
            or asdict(plan.target) != intent["target"] or plan.import_id != intent["source"]["reference"]
            or set(plan.decisions.values()["sources"]) != set(intent["selected"])):
        raise ValueError("approval binding differs")
    _path, manifest = load_workspace(path)
    if (normalize_endpoint(endpoint(manifest)) != plan.target.endpoint
            or manifest["instance"] != intent["fake_instance"] or intent["state_binding"] != "state"
            or intent["artifacts"] != artifact_hashes(plan)):
        raise ValueError("target drift")
    return plan, path / "state/execution/runs" / key


def start_or_adopt(path: Path, key: str, *, cancelled=None) -> dict:
    """Redelivery adopts snapshots, never implicitly resumes failed/unknown work."""
    if state_root().resolve() != (path / "state").resolve():
        raise ValueError("use supervised private state binding, never caller canonical state")
    with FileLock(path / "apply.lock"):
        plan, directory = load_intent(path, key)
        existing = inspect_binding(plan, directory)
        if existing:
            if existing.snapshot is None:
                raise JournalError("reservation without journal; recovery required")
            return {"adopted": True, "snapshot": existing.snapshot}
        api, target = fake_api(path)
        snapshot = execute_stock(plan, api=api, current_target=target,
                                 run_directory=directory, cancelled=cancelled)
        return {"adopted": False, "snapshot": snapshot}

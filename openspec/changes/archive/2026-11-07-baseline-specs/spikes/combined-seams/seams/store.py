"""Application transactions bind observations, human facts and exact approvals."""

from dataclasses import asdict
from pathlib import Path

from django.db import transaction

from coordination.boundary import artifact, canonical, decode, message, sha
from coordination.models import Intent, Job, Question
from coordination.store import check_owner, insert_intent, payload_digest, workflow_id
from adapter import artifact_hashes, build_digest, question_context
from invimport.execution.models import Plan
from validate_proposal import validate_fixture_proposal

from .fingerprint import combined_build
from .models import Approval, ApplyOutbox, Projection
from .observations import messages, validate_input

VERSION = "combined-seams-v1"
WORKFLOW = "combined_command_v1"
QUEUE = "combined-serial"


def authorize(principal: str, claimed: str) -> None:
    # Trusted command identity supplied separately, NOT a network login mechanism.
    if principal != "fixture-user" or claimed != principal:
        raise ValueError("unauthorized command principal")


def submit(request: dict, bundle: Path, *, version: str = VERSION) -> str:
    raw = validate_input(request, bundle)
    identifier = workflow_id(request)
    with transaction.atomic():
        job, _ = Job.objects.get_or_create(
            id=f"{request['batch_id']}:{request['job_id']}",
            defaults={"batch_id": request["batch_id"], "job_id": request["job_id"],
                      "current_attempt": "", "input_revision": request["input_revision"]},
        )
        job = Job.objects.select_for_update().get(pk=job.pk)
        existing = Intent.objects.filter(pk=identifier).first()
        if existing:
            if existing.payload_digest != payload_digest(request, version):
                raise ValueError("changed command payload/version")
            return identifier
        if job.current_attempt:
            raise ValueError("new attempt requires authorized answer")
        if request["attempt_id"] != "attempt-1":
            raise ValueError("initial request must retain unresolved human fact")
        return insert_intent(job, request, raw, version).pk


def answer(reply: dict, bundle: Path, *, principal: str) -> str:
    reply = message(canonical(reply))
    authorize(principal, reply["actor_id"])
    if reply["type"] != "job.answer":
        raise ValueError("not an answer")
    with transaction.atomic():
        intent = Intent.objects.get(pk=workflow_id(reply))
        job = Job.objects.select_for_update().get(pk=intent.job_id)
        check_owner(intent, job, reply)
        question = Question.objects.get(pk=f"{intent.pk}:{reply['question_id']}")
        if (job.state != "waiting_for_user" or question.answer is not None
                or question.payload["question_revision"] != reply["question_revision"]):
            raise ValueError("obsolete question revision/state")
        if reply["value"] != "20" or reply["question_id"] != "count-lot-b":
            raise ValueError("retained continuation supports counted 20 only")
        updated = decode(bytes(intent.input_bytes))
        updated["lots"][1]["quantity"] = reply["value"]
        updated["human_answers"].append({key: reply[key] for key in (
            "question_id", "question_revision", "value", "actor_id",
        )})
        request = next(item for item in messages() if item["type"] == "job.request"
                       and item["attempt_id"] == "attempt-2")
        raw = validate_input(request, bundle)
        if decode(raw) != updated:
            raise ValueError("answer not reflected in immutable continuation")
        question.answer = reply
        question.save(update_fields=["answer"])
        return insert_intent(job, request, raw, intent.app_version).pk


def apply_digest(payload: dict, workspace: str, research: str, version: str) -> str:
    return sha(canonical([payload, workspace, research, version]))


def approve(research: str, workspace: Path, plan: Plan, binding: dict, *, principal: str) -> str:
    authorize(principal, principal)
    workspace = workspace.resolve(strict=True)
    report = validate_fixture_proposal(workspace / "source/proposal.json")
    if (binding["plan_revision"] != plan.revision
            or binding["plan_sha256"] != sha(plan.dumps().encode())
            or binding["build"] != build_digest()
            or binding["artifacts"] != artifact_hashes(plan)
            or binding["input_revision"] != question_context(workspace)["input_revision"]
            or binding["proposal_sha256"] != report["proposal_sha256"]
            or binding["target"] != asdict(plan.target)
            or binding["source"]["reference"] != plan.import_id
            or set(binding["selected"]) != set(plan.decisions.values()["sources"])):
        raise ValueError("approval differs from selected prepared bytes")
    config = {p.name: sha(p.read_bytes()) for p in sorted((workspace / "config").iterdir()) if p.is_file()}
    if binding["config"] != config:
        raise ValueError("configuration changed before approval")
    payload = {**binding, "actor": principal, "plan": plan.dumps(), "combined_build": combined_build()}
    identifier = sha(canonical(payload))
    digest = apply_digest(payload, str(workspace), research, VERSION)
    with transaction.atomic():
        intent = Intent.objects.get(pk=research)
        job = Job.objects.select_for_update().get(pk=intent.job_id)
        if (job.current_attempt != research or job.state != "succeeded"
                or job.input_revision != binding["input_revision"]
                or bytes(intent.input_bytes) != (workspace / "source/input.json").read_bytes()):
            raise ValueError("approval has no current accepted research/answer")
        # Bind to the actual accepted result, not a mutable workspace substitution.
        emitted = intent.emission_set.get(payload__type="job.result").payload
        if emitted["output_ref"]["sha256"] != binding["proposal_sha256"]:
            raise ValueError("approval proposal differs from accepted provider bytes")
        existing = Approval.objects.filter(pk=identifier).first()
        if existing:
            if existing.command_digest != digest:
                raise ValueError("approval location/command conflict")
            return identifier
        approval = Approval.objects.create(id=identifier, research=intent, payload=payload,
                                           workspace=str(workspace), command_digest=digest, version=VERSION)
        ApplyOutbox.objects.create(approval=approval)
    return identifier


def bound_approval(identifier: str, digest: str) -> Approval:
    row = Approval.objects.get(pk=identifier)
    if (sha(canonical(row.payload)) != identifier or row.command_digest != digest
            or row.payload["combined_build"] != combined_build()
            or apply_digest(row.payload, row.workspace, row.research_id, row.version) != digest):
        raise ValueError("immutable approval binding conflict")
    return row


def publish(identifier: str, snapshot: dict | None, disposition: str) -> None:
    with transaction.atomic():
        Approval.objects.select_for_update().get(pk=identifier)
        row, _ = Projection.objects.get_or_create(approval_id=identifier,
                                                  defaults={"disposition": "unpublished"})
        row.cursor += 1
        row.snapshot = snapshot
        row.disposition = disposition
        row.save()


def validate_result(bundle: Path, emitted: dict) -> dict:
    raw = artifact(bundle, emitted["output_ref"])
    report = validate_fixture_proposal(bundle / emitted["output_ref"]["path"])
    if report["proposal_sha256"] != sha(raw):
        raise ValueError("changed provider bytes during validation")
    return report

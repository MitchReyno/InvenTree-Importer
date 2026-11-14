"""Application transactions and acceptance; DBOS is not the domain authority."""

from pathlib import Path

from django.db import transaction

from .boundary import FIXTURE, artifact, canonical, decode, message, request_input, sha
from .models import Emission, Intent, Job, Outbox, Question

VERSION = "coordination-v1"
WORKFLOW = "bench_intake_command_v1"
QUEUE = "bench-intake-serial"


def workflow_id(request: dict) -> str:
    identity = [request[k] for k in ("batch_id", "job_id", "attempt_id")]
    return "intake-" + sha(canonical(identity))


def payload_digest(request: dict, version: str) -> str:
    return sha(canonical({"request": request, "app_version": version}))


def insert_intent(job: Job, request: dict, raw: bytes, version: str) -> Intent:
    identifier = workflow_id(request)
    intent = Intent.objects.create(
        id=identifier, job=job, attempt_id=request["attempt_id"], payload=request,
        payload_digest=payload_digest(request, version), input_bytes=raw, app_version=version,
    )
    Outbox.objects.create(intent=intent)
    job.current_attempt = identifier
    job.input_revision = request["input_revision"]
    job.state = "queued"
    job.save()
    return intent


def submit(raw_request: bytes, *, version: str = VERSION, bundle: Path = FIXTURE) -> str:
    request = message(raw_request)
    raw = request_input(request, bundle)
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
                raise ValueError("Workflow ID already bound to different payload/version")
            return identifier
        if job.current_attempt:
            raise ValueError("New attempt requires a recorded answer continuation")
        return insert_intent(job, request, raw, version).pk


def check_owner(intent: Intent, job: Job, emitted: dict) -> None:
    for key in ("batch_id", "job_id", "attempt_id", "input_revision"):
        if emitted[key] != intent.payload[key]:
            raise ValueError(f"Unowned message {key}")
    if job.current_attempt != intent.pk or job.input_revision != emitted["input_revision"]:
        raise ValueError("Obsolete attempt/input")


def validate_proposal(output: dict, manifest: dict) -> None:
    """Bounded synthetic domain check; shared suite owns full importer validation."""
    if output["source"]["reference"] != manifest["source_reference"]:
        raise ValueError("Changed source identity")
    if [p["id"] for p in output["parts"]] != [p["id"] for p in manifest["parts"]]:
        raise ValueError("Changed shared Part identities")
    if len(output["lines"]) != len(manifest["lots"]):
        raise ValueError("Changed physical lot count")
    for line, lot in zip(output["lines"], manifest["lots"], strict=True):
        if (line["id"], line["part"], line["quantity"], line["batch"]) != (
            lot["id"], lot["part_id"], lot["quantity"], lot["batch"],
        ):
            raise ValueError("Changed physical contribution")


def accept(identifier: str, raw_message: bytes, *, bundle: Path = FIXTURE) -> str:
    emitted = message(raw_message)
    if emitted["type"] not in ("job.event", "job.question", "job.result"):
        raise ValueError("Not a runner emission")
    with transaction.atomic():
        intent = Intent.objects.get(pk=identifier)
        job = Job.objects.select_for_update().get(pk=intent.job_id)
        check_owner(intent, job, emitted)
        emission_id = f"{identifier}:{emitted['sequence']}"
        digest = sha(canonical(emitted))
        existing = Emission.objects.filter(pk=emission_id).first()
        if existing:
            if existing.digest != digest:
                raise ValueError("Conflicting sequence redelivery")
            return "duplicate"
        if job.state not in ("queued", "running"):
            raise ValueError("Command already finished")
        expected = Emission.objects.filter(intent=intent).count() + 1
        if emitted["sequence"] != expected:
            raise ValueError("Noncontiguous sequence")
        if emitted["type"] == "job.question":
            Question.objects.create(
                id=f"{identifier}:{emitted['question_id']}", intent=intent, payload=emitted,
            )
        if emitted["type"] == "job.result":
            if emitted["status"] == "waiting_for_user":
                pending = list(Question.objects.filter(intent=intent, answer__isnull=True))
                if sorted(q.payload["question_id"] for q in pending) != sorted(emitted["question_ids"]):
                    raise ValueError("Result references unpersisted questions")
            elif emitted["status"] == "succeeded":
                if Question.objects.filter(intent=intent, answer__isnull=True).exists():
                    raise ValueError("Unanswered question cannot succeed")
                output = decode(artifact(bundle, emitted["output_ref"]))
                validate_proposal(output, decode(bytes(intent.input_bytes)))
            job.state = emitted["status"]
        else:
            job.state = "running"
        Emission.objects.create(id=emission_id, intent=intent, sequence=emitted["sequence"],
                                payload=emitted, digest=digest)
        job.save()
    return "accepted"


def answer(raw_answer: bytes, *, actor: str) -> str:
    """Trusted CLI supplies actor separately. Only the authored counted-20 case is simulated."""
    reply = message(raw_answer)
    if reply["type"] != "job.answer" or reply["actor_id"] != actor:
        raise ValueError("Answer actor/type mismatch")
    with transaction.atomic():
        identifier = workflow_id(reply)
        intent = Intent.objects.get(pk=identifier)
        job = Job.objects.select_for_update().get(pk=intent.job_id)
        check_owner(intent, job, reply)
        question = Question.objects.get(pk=f"{identifier}:{reply['question_id']}")
        if (job.state != "waiting_for_user" or question.answer is not None
                or question.payload["question_revision"] != reply["question_revision"]):
            raise ValueError("Obsolete question revision/state")
        if reply["value"] != "20" or reply["question_id"] != "count-lot-b":
            raise ValueError("Synthetic continuation supports counted 20 only")
        original = decode(bytes(intent.input_bytes))
        updated = decode(canonical(original))
        updated["lots"][1]["quantity"] = reply["value"]
        updated["human_answers"].append({k: reply[k] for k in (
            "question_id", "question_revision", "value", "actor_id",
        )})
        # Match the shared authored bytes, not a mutable old manifest or a guessed hash.
        confirmed = (FIXTURE / "input-confirmed.json").read_bytes()
        if decode(confirmed) != updated:
            raise ValueError("Continuation differs from confirmed synthetic manifest")
        request = dict(intent.payload)
        request.update(attempt_id="attempt-2", input_revision=sha(confirmed), input_ref={
            "path": "input-confirmed.json", "sha256": sha(confirmed),
            "media_type": "application/json",
        })
        request_input(message(canonical(request)))
        question.answer = reply
        question.save()
        return insert_intent(job, request, confirmed, intent.app_version).pk

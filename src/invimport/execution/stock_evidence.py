"""Immutable attachment/image transfers and content-verified reconciliation."""
from __future__ import annotations

from base64 import b64decode, b64encode
from dataclasses import dataclass, replace
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from urllib.parse import urljoin, urlsplit

from requests import HTTPError

from .executor import OperationContext
from .models import (
    Attribution,
    Certainty,
    Effect,
    ErrorCategory,
    Inputs,
    Kind,
    OperationResult,
    OperationSpec,
    Output,
    OutputRef,
    Plan,
    Retry,
    SafeError,
    State,
    digest,
    validate_plan,
)
from .stock_api import StockRequests


@dataclass(frozen=True)
class FrozenEvidence:
    line: str
    filename: str
    content: bytes

    def __post_init__(self) -> None:
        if (not self.filename or PurePosixPath(self.filename).name != self.filename
                or self.filename in {".", ".."} or "\\" in self.filename):
            raise ValueError("evidence filename must be a portable basename")
        if not isinstance(self.content, bytes):
            raise ValueError("evidence requires owned immutable bytes")


def with_evidence(plan: Plan, artifact: FrozenEvidence) -> Plan:
    """Freeze bytes and exact logical target before approving this revision."""
    targets = [op for op in plan.operations if op.kind == Kind.STOCK and artifact.line in op.attribution.lines]
    if len(targets) != 1:
        raise ValueError("evidence requires exactly one planned stock target")
    content_hash = sha256(artifact.content).hexdigest()
    operation = OperationSpec.build(Kind.EVIDENCE, targets[0].subject, discriminator=content_hash,
        desired=Inputs.freeze({"action": "evidence", "filename": artifact.filename,
                               "sha256": content_hash, "bytes": b64encode(artifact.content).decode("ascii")}),
        requires=(OutputRef(targets[0].id, "record"),), provides=("record",),
        attribution=Attribution(plan.import_id, (artifact.line,)), reconciliation="stock_v1")
    result = replace(plan, operations=(*plan.operations, operation))
    validate_plan(result)
    return result


def _verified(api: StockRequests, attachment: dict, content_hash: str) -> bool | None:
    location = attachment.get("attachment")
    if not isinstance(location, str) or not location:
        return None
    target = urlsplit(urljoin(api.api_url, location))
    origin = urlsplit(api.api_url)
    if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
        return None  # never send credentials to a media URL on another host
    with TemporaryDirectory(prefix="invimport-evidence-") as directory:
        path = Path(directory) / "verify"
        function = lambda: api.api.downloadFile(location, str(path), overwrite=True)
        api._check()
        if getattr(api.api, "_invimport_guarded", False):
            function()
        else:
            api.context.dispatch(function, mutation=False, label="get_evidence_bytes")
        return sha256(path.read_bytes()).hexdigest() == content_hash


def ensure_evidence(spec: OperationSpec, context: OperationContext, api: StockRequests,
                    inputs: list[tuple[Output, dict]], *, repair: bool) -> OperationResult:
    from ..inventree.collections import list_rows
    from .stock_handlers import _success, review
    desired = spec.desired.values()
    content = b64decode(desired["bytes"], validate=True)
    if sha256(content).hexdigest() != desired["sha256"]:
        return review("frozen_artifact_corrupt")
    target, current = inputs[0]
    if desired.get("staged_by"):
        from .stock_finalization import artifact_path, retained_hash
        staged = artifact_path(context.store.path.parent, desired["staged_by"])
        if not staged.is_file() or retained_hash(context, desired["staged_by"]) != desired["sha256"] or sha256(staged.read_bytes()).hexdigest() != desired["sha256"]:
            return review("retained_source_artifact_missing_or_corrupt")
    image = desired.get("image", False)
    if desired.get("only_created"):
        creator = context.store.results().get(spec.requires[0].operation)
        if creator is None or not any(effect.kind == "create" and effect.certainty == Certainty.CONFIRMED
                                      and effect.pk == target.pk for effect in creator.effects):
            return OperationResult(State.SKIPPED)
    if image and current.get("image"):
        verified = _verified(api, {"attachment": current["image"]}, desired["sha256"])
        if verified is True:
            return _success(target)
        previous = context.store.results().get(spec.id)
        if previous and any(effect.kind == "upload" for effect in previous.effects):
            return review("uploaded_image_not_verified")
        # The caller approves only filling an empty primary image, never replacing one.
        return OperationResult(State.SKIPPED)
    # Persist pending bytes locally independently of further inventory writes.
    artifact = context.store.path.parent / "artifacts" / (digest([spec.id, desired["filename"]]) + ".bin")
    if not artifact.exists():
        from .stock_finalization import save_immutable
        save_immutable(artifact, content, context)
    elif artifact.read_bytes() != content:
        return review("staged_artifact_corrupt")
    rows = [] if image else list_rows(api, "attachment/", params={"model_type": target.model, "model_id": target.pk})
    matches = [row for row in rows if str(row.get("filename", "")).rsplit("/", 1)[-1] == desired["filename"]]
    if len(matches) > 1:
        return review("ambiguous_evidence")
    if matches:
        verified = _verified(api, matches[0], desired["sha256"])
        if verified is True:
            with context.store.transaction() as connection:
                context.store._event(connection, "evidence_verified", spec.id, context.attempt.id,
                                     sha256=desired["sha256"], model=target.model, pk=target.pk)
            return _success(target)
        return review("evidence_bytes_conflict" if verified is False else "evidence_verification_unavailable")
    if repair:
        previous = context.store.results().get(spec.id)
        if desired.get("versioned"):
            import json
            receipts = context.store.connection.execute(
                "SELECT kind,attempt,safe_json FROM events WHERE operation=? AND kind IN ('evidence_uploaded','evidence_transfer_started')", (spec.id,)).fetchall()
            matching = [(kind, attempt) for kind, attempt, payload in receipts if json.loads(payload).get("sha256") == desired["sha256"]]
            if any(kind == "evidence_uploaded" for kind, _ in matching):
                return review("uploaded_evidence_not_visible")
            attempts = [attempt for kind, attempt in matching if kind == "evidence_transfer_started"]
            for attempt in attempts:
                state = context.store.connection.execute("SELECT state FROM attempts WHERE id=?", (attempt,)).fetchone()
                if state and state[0] in {State.UNCERTAIN, State.RUNNING}:
                    return review("uncorrelated_evidence_upload", unknown=True)
                exchanges = context.store.connection.execute("SELECT state FROM requests WHERE attempt=? AND mutation=1", (attempt,)).fetchall()
                if any(state in {"intent", "exchange_unknown"} for state, in exchanges):
                    return review("uncorrelated_evidence_upload", unknown=True)
        elif previous:
            if any(effect.kind == "upload" and effect.certainty == Certainty.CONFIRMED for effect in previous.effects):
                return review("uploaded_evidence_not_visible")
            if previous.certainty == Certainty.UNKNOWN:
                return review("uncorrelated_evidence_upload", unknown=True)
    with context.store.transaction() as connection:
        context.store._event(connection, "evidence_transfer_started", spec.id, context.attempt.id,
                             sha256=desired["sha256"], model=target.model, pk=target.pk)
    try:
        from .stock_handlers import ROUTES
        route = f"{ROUTES[target.model]}{target.pk}/" if image else "attachment/"
        response = api.request(route, method="PATCH" if image else "POST",
                               data={} if image else {"model_type": target.model, "model_id": target.pk,
                                                      "comment": desired.get("comment", "")},
                               files={"image" if image else "attachment": (desired["filename"], BytesIO(content))})
    except HTTPError as exc:
        from ..inventree.stock import _http_failure
        status, _ = _http_failure(exc)
        if status in {400, 401, 403, 404, 405, 422}:
            return OperationResult(State.FAILED, retry=Retry.RECONCILE,
                                   error=SafeError(ErrorCategory.DENIED, "evidence_upload_rejected"))
        raise
    if response is None or response.status_code not in {200, 201}:
        return review("evidence_upload_response_unknown", unknown=True)
    with context.store.transaction() as connection:
        context.store._event(connection, "evidence_uploaded", spec.id, context.attempt.id,
                             sha256=desired["sha256"], model=target.model, pk=target.pk)
    context.store.checkpoint(context.attempt, replace(review("uploaded_evidence_not_verified"),
                             certainty=Certainty.CONFIRMED, outputs=(target,),
                             effects=(Effect("upload", Certainty.CONFIRMED, target.model, target.pk),)))
    # A successful upload response confirms a transfer, not remote byte identity.
    if image:
        from .stock_handlers import ROUTES
        current = api.get(f"{ROUTES[target.model]}{target.pk}/")
        matches = [{"attachment": current.get("image")} ] if current.get("image") else []
        if len(matches) != 1 or _verified(api, matches[0], desired["sha256"]) is not True:
            return replace(review("uploaded_image_not_verified"), certainty=Certainty.CONFIRMED,
                           effects=(Effect("upload", Certainty.CONFIRMED, target.model, target.pk),))
        return replace(_success(target), state=State.SUCCEEDED,
                       effects=(Effect("upload", Certainty.CONFIRMED, target.model, target.pk),))
    rows = list_rows(api, "attachment/", params={"model_type": target.model, "model_id": target.pk})
    matches = [row for row in rows if str(row.get("filename", "")).rsplit("/", 1)[-1] == desired["filename"]]
    if len(matches) != 1 or _verified(api, matches[0], desired["sha256"]) is not True:
        return replace(review("uploaded_evidence_not_verified"), certainty=Certainty.CONFIRMED,
                       effects=(Effect("upload", Certainty.CONFIRMED, target.model, target.pk),))
    return replace(_success(target, created=False), state=State.SUCCEEDED, effects=(Effect("upload", Certainty.CONFIRMED, target.model, target.pk),))

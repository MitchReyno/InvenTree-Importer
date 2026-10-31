"""One immutable artifact/target boundary; full archive migration is Stage 5."""
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
    target = inputs[0][0]
    # Persist pending bytes locally independently of further inventory writes.
    artifact = context.store.path.parent / "artifacts" / (digest([spec.id, desired["filename"]]) + ".bin")
    if not artifact.exists():
        artifact.write_bytes(content)
        artifact.chmod(0o600)
    elif artifact.read_bytes() != content:
        return review("staged_artifact_corrupt")
    rows = list_rows(api, "attachment/", params={"model_type": target.model, "model_id": target.pk})
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
        previous = context.store.results()[spec.id]
        if any(effect.kind == "upload" and effect.certainty == Certainty.CONFIRMED for effect in previous.effects):
            return review("uploaded_evidence_not_visible")
        if previous.certainty == Certainty.UNKNOWN:
            return review("uncorrelated_evidence_upload", unknown=True)
    try:
        response = api.request("attachment/", method="POST",
                               data={"model_type": target.model, "model_id": target.pk},
                               files={"attachment": (desired["filename"], BytesIO(content))})
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
    rows = list_rows(api, "attachment/", params={"model_type": target.model, "model_id": target.pk})
    matches = [row for row in rows if str(row.get("filename", "")).rsplit("/", 1)[-1] == desired["filename"]]
    if len(matches) != 1 or _verified(api, matches[0], desired["sha256"]) is not True:
        return replace(review("uploaded_evidence_not_verified"), certainty=Certainty.CONFIRMED,
                       effects=(Effect("upload", Certainty.CONFIRMED, target.model, target.pk),))
    return replace(_success(target, created=False), state=State.SUCCEEDED, effects=(Effect("upload", Certainty.CONFIRMED, target.model, target.pk),))

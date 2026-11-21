"""Retained provider observation replay; never imports a native runtime."""

import shutil
from pathlib import Path

from .bootstrap import ROOT, paths

paths()
from coordination.boundary import FIXTURE, artifact, canonical, decode, message, sha  # noqa: E402

OBSERVED = ROOT / "spikes/subscription-runtime/observed"


def messages() -> list[dict]:
    return [message(line) for line in (OBSERVED / "messages.jsonl").read_bytes().splitlines()]


def stage(path: Path) -> None:
    path.mkdir(mode=0o700)
    shutil.copytree(FIXTURE / "evidence", path / "evidence")
    for name in ("input.json", "input-confirmed.json"):
        shutil.copy2(FIXTURE / name, path / name)
    shutil.copy2(OBSERVED / "proposal.json", path / "proposal.json")
    for request in (item for item in messages() if item["type"] == "job.request"
                    and item["attempt_id"] in {"attempt-1", "attempt-2"}):
        validate_input(request, path)


def validate_input(request: dict, bundle: Path) -> bytes:
    request = message(canonical(request))
    if request["type"] != "job.request" or request["provider"] != "codex":
        raise ValueError("retained Codex request required")
    raw = artifact(bundle, request["input_ref"])
    manifest = decode(raw)
    if sha(raw) != request["input_revision"] or manifest["batch_id"] != request["batch_id"]:
        raise ValueError("manifest identity mismatch")
    for reference in manifest["evidence"]:
        artifact(bundle, reference)
    template = next((item for item in messages() if item["type"] == "job.request"
                     and item["attempt_id"] == request["attempt_id"]), None)
    if template != request:
        raise ValueError("unsupported retained observation request")
    return raw


def emissions(attempt: str) -> list[dict]:
    result = [item for item in messages() if item["attempt_id"] == attempt
              and item["type"] in {"job.event", "job.question", "job.result"}]
    if not result or result[-1]["type"] != "job.result":
        raise ValueError("incomplete retained observation")
    first = decode((OBSERVED / "attempt-1-response.json").read_bytes())
    second = decode((OBSERVED / "attempt-2-response.json").read_bytes())
    if attempt == "attempt-1":
        question = next(item for item in result if item["type"] == "job.question")
        if question["prompt"] != first["question"]:
            raise ValueError("outer question differs from actual provider response")
    elif attempt == "attempt-2":
        if second["stock"] != decode((OBSERVED / "proposal.json").read_bytes()):
            raise ValueError("proposal differs from actual provider response")
    else:
        raise ValueError("unsupported replay")
    return result

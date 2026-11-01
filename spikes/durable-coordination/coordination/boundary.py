"""Strict synthetic contract decoding and byte integrity checks, without Django."""

import hashlib
import json
import math
from decimal import Decimal
from pathlib import Path, PurePosixPath

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "spikes/shared/fixtures/two-lots"
SCHEMA = ROOT / "spikes/shared/schemas/message.schema.json"


def reject_constant(value: str) -> None:
    raise ValueError(f"Nonfinite JSON number: {value}")


def unique_object(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def finite_float(value: str) -> int | float:
    number = float(value)
    if not math.isfinite(number):
        reject_constant(value)
    if number.is_integer():
        exact = Decimal(value)
        integer = int(exact)
        if exact != integer:
            raise ValueError("Lossy JSON integer")
        return integer
    return number


def decode(raw: bytes | str) -> dict | list:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(
        raw, object_pairs_hook=unique_object, parse_constant=reject_constant,
        parse_float=finite_float,
    )


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def message(raw: bytes | str) -> dict:
    value = decode(raw)
    Draft202012Validator(decode(SCHEMA.read_bytes())).validate(value)
    # JSON Schema considers 1.0 an integer too. Normalize accepted integer fields so a
    # transport spelling cannot create another emission ID or a false duplicate conflict.
    for field in ("sequence", "question_revision"):
        if field in value:
            value[field] = int(value[field])
    return value


def artifact(bundle: Path, reference: dict) -> bytes:
    path = PurePosixPath(reference["path"])
    if path.is_absolute() or not path.parts or any(p in ("..", ".") for p in path.parts):
        raise ValueError("Artifact path escapes bundle")
    root = bundle.resolve(strict=True)
    candidate = (root / str(path)).resolve(strict=True)
    if not candidate.is_relative_to(root):
        raise ValueError("Artifact symlink escapes bundle")
    raw = candidate.read_bytes()
    if sha(raw) != reference["sha256"]:
        raise ValueError("Artifact digest mismatch")
    return raw


def request_input(request: dict, bundle: Path = FIXTURE) -> bytes:
    if request["type"] != "job.request" or request["provider"] != "fixture":
        raise ValueError("This runner accepts synthetic fixture requests only")
    raw = artifact(bundle, request["input_ref"])
    if sha(raw) != request["input_revision"]:
        raise ValueError("Input revision mismatch")
    manifest = decode(raw)
    if manifest["batch_id"] != request["batch_id"]:
        raise ValueError("Input batch mismatch")
    for ref in manifest["evidence"]:
        artifact(bundle, ref)
    return raw


def transcript() -> list[dict]:
    return [message(line) for line in (FIXTURE / "messages.jsonl").read_bytes().splitlines()]

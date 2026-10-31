"""Immutable, JSON-only execution contracts; logical identity never contains a PK."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from hashlib import sha256
import json
from typing import Mapping


SCHEMA_VERSION = 1


def canonical(value: object) -> str:
    """Reject non-JSON objects and nonfinite numbers at the persistence boundary."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: object) -> str:
    return sha256(canonical(value).encode()).hexdigest()


@dataclass(frozen=True)
class Inputs:
    """Own a frozen copy of desired JSON values, never a caller's mutable dict."""
    json: str = "{}"

    def __post_init__(self) -> None:
        parsed = json.loads(self.json)
        if not isinstance(parsed, dict):
            raise ValueError("operation inputs must be an object")
        object.__setattr__(self, "json", canonical(parsed))

    @classmethod
    def freeze(cls, values: Mapping) -> Inputs:
        return cls(canonical(dict(values)))

    def values(self) -> dict:
        return json.loads(self.json)


class Kind(StrEnum):
    DISCOVERY = "discovery"
    PART = "part"
    COMPANY = "company"
    PARAMETER = "parameter"
    STOCK = "stock"
    BARCODE = "barcode"
    METADATA = "metadata"
    EVIDENCE = "evidence"


class State(StrEnum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    ALREADY_SATISFIED = "already_satisfied"
    RETRY_WAIT = "retry_wait"
    FAILED = "failed"
    UNCERTAIN = "uncertain"
    NEEDS_REVIEW = "needs_review"
    BLOCKED = "blocked"
    SKIPPED = "skipped"


class Certainty(StrEnum):
    NONE = "none"
    CONFIRMED = "confirmed"
    UNKNOWN = "unknown"


class Retry(StrEnum):
    NEVER = "never"
    READ = "read"
    RECONCILE = "reconcile"
    REVIEW = "review"


class ErrorCategory(StrEnum):
    ABSENT = "absent"
    VALIDATION = "validation"
    CONFLICT = "conflict"
    DENIED = "denied_auth"
    TRANSIENT = "transient"
    TRANSPORT = "transport"
    INVALID_RESPONSE = "invalid_response"
    UNCERTAIN_WRITE = "uncertain_write"
    PROGRAMMER = "programmer_error"
    JOURNAL = "local_journal_failure"


@dataclass(frozen=True)
class SafeError:
    category: ErrorCategory
    code: str

    def __post_init__(self) -> None:
        # Codes are controlled identifiers, never arbitrary SDK exception text.
        if not self.code or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789_" for c in self.code):
            raise ValueError("error code must be a safe identifier")


@dataclass(frozen=True)
class Attribution:
    source: str
    lines: tuple[str, ...] = ()


@dataclass(frozen=True)
class OutputRef:
    operation: str
    name: str


@dataclass(frozen=True)
class Output:
    name: str
    model: str
    pk: int
    identity_digest: str

    def __post_init__(self) -> None:
        if type(self.pk) is not int or self.pk <= 0 or not self.identity_digest:
            raise ValueError("output requires a positive PK and record identity evidence")


@dataclass(frozen=True)
class Effect:
    kind: str
    certainty: Certainty
    model: str = ""
    pk: int | None = None


@dataclass(frozen=True)
class OperationSpec:
    id: str
    kind: Kind
    subject: str
    desired: Inputs = field(default_factory=Inputs)
    baseline: Inputs = field(default_factory=Inputs)
    requires: tuple[OutputRef, ...] = ()
    provides: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    attribution: Attribution = field(default_factory=lambda: Attribution(""))
    group: str = ""
    required: bool = True
    mutation: bool = True
    reconciliation: str = "review"

    @classmethod
    def build(cls, kind: Kind, subject: str, *, discriminator: str = "", **kwargs) -> OperationSpec:
        identity = digest([SCHEMA_VERSION, kind.value, subject, discriminator])
        return cls(f"v1:{kind.value}:{identity}", kind, subject, **kwargs)


@dataclass(frozen=True)
class OperationResult:
    state: State
    certainty: Certainty = Certainty.NONE
    retry: Retry = Retry.NEVER
    outputs: tuple[Output, ...] = ()
    effects: tuple[Effect, ...] = ()
    error: SafeError | None = None

    def __post_init__(self) -> None:
        if self.state in {State.PENDING, State.READY, State.RUNNING}:
            raise ValueError("result must be a settled operation outcome")
        if self.state in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} and (
                self.certainty == Certainty.UNKNOWN or any(e.certainty == Certainty.UNKNOWN for e in self.effects)):
            raise ValueError("unresolved effects cannot be a successful outcome")
        if self.certainty == Certainty.UNKNOWN and self.retry not in {Retry.RECONCILE, Retry.REVIEW}:
            raise ValueError("unknown effects require reconciliation or review")
        if len({o.name for o in self.outputs}) != len(self.outputs):
            raise ValueError("duplicate output name")


@dataclass(frozen=True)
class Target:
    endpoint: str
    instance_id: str = ""
    identity_evidence: str = ""


@dataclass(frozen=True)
class Plan:
    import_id: str
    input_version: int
    input_digest: str
    config_digest: str
    files: Inputs
    target: Target
    decisions: Inputs
    operations: tuple[OperationSpec, ...]
    unsupported: tuple[str, ...] = ()
    schema_version: int = SCHEMA_VERSION
    normalization_version: int = 1

    @property
    def revision(self) -> str:
        return digest(asdict(self))

    def dumps(self) -> str:
        return canonical(asdict(self))

    @classmethod
    def loads(cls, text: str) -> Plan:
        value = json.loads(text)
        if (type(value.get("schema_version")) is not int or value.get("schema_version") != SCHEMA_VERSION
                or type(value.get("normalization_version")) is not int or value.get("normalization_version") != 1):
            raise ValueError("unsupported execution plan schema")
        operations = []
        for raw in value.pop("operations"):
            raw["kind"] = Kind(raw["kind"])
            raw["desired"] = Inputs(**raw["desired"])
            raw["baseline"] = Inputs(**raw["baseline"])
            raw["requires"] = tuple(OutputRef(**r) for r in raw["requires"])
            raw["attribution"] = Attribution(raw["attribution"]["source"], tuple(raw["attribution"]["lines"]))
            for key in ("provides", "conflicts"):
                raw[key] = tuple(raw[key])
            operations.append(OperationSpec(**raw))
        value["files"] = Inputs(**value["files"])
        value["decisions"] = Inputs(**value["decisions"])
        value["target"] = Target(**value["target"])
        value["unsupported"] = tuple(value["unsupported"])
        plan = cls(**value, operations=tuple(operations))
        validate_plan(plan)
        return plan


def validate_plan(plan: Plan) -> None:
    """Validate dependencies separately from visual groups and shared resources."""
    if (type(plan.schema_version) is not int or plan.schema_version != SCHEMA_VERSION
            or type(plan.input_version) is not int or plan.input_version not in {1, 2}
            or type(plan.normalization_version) is not int or plan.normalization_version != 1):
        raise ValueError("unsupported execution plan schema")
    operations = {op.id: op for op in plan.operations}
    if len(operations) != len(plan.operations):
        raise ValueError("duplicate operation identity")
    resources: dict[str, str] = {}
    for op in plan.operations:
        for resource in op.conflicts:
            signature = digest([op.kind, op.desired.json, op.baseline.json, [asdict(r) for r in op.requires]])
            if resource in resources and resources[resource] != signature:
                raise ValueError("conflicting shared resource inputs")
            resources[resource] = signature
        for ref in op.requires:
            if ref.operation not in operations or ref.name not in operations[ref.operation].provides:
                raise ValueError("missing prerequisite output")
    remaining = set(operations)
    while remaining:
        ready = {key for key in remaining if all(r.operation not in remaining for r in operations[key].requires)}
        if not ready:
            raise ValueError("cyclic operation dependencies")
        remaining -= ready

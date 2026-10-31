"""Immutable, JSON-only execution contracts; logical identity never contains a PK."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
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


def _text(value: object, *, name: str, required: bool = False) -> None:
    if not isinstance(value, str) or (required and not value):
        raise ValueError(f"{name} must be {'nonempty ' if required else ''}text")


def _owned_sequence(value: object, item_type: type) -> tuple:
    if not isinstance(value, (tuple, list)) or any(not isinstance(item, item_type) for item in value):
        raise ValueError("invalid execution record sequence")
    return tuple(value)


def _record(value: object, model: type) -> dict:
    if not isinstance(value, dict) or set(value) != {f.name for f in fields(model)}:
        raise ValueError(f"invalid {model.__name__} schema fields")
    return dict(value)


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON object key")
        value[key] = item
    return value


@dataclass(frozen=True)
class Inputs:
    """Own a frozen copy of desired JSON values, never a caller's mutable dict."""
    json: str = "{}"

    def __post_init__(self) -> None:
        _text(self.json, name="inputs JSON")
        parsed = json.loads(self.json, object_pairs_hook=_unique_object)
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
        object.__setattr__(self, "category", ErrorCategory(self.category))
        _text(self.code, name="error code", required=True)
        # Codes are controlled identifiers, never arbitrary SDK exception text.
        if not self.code or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789_" for c in self.code):
            raise ValueError("error code must be a safe identifier")


@dataclass(frozen=True)
class Attribution:
    source: str
    lines: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _text(self.source, name="source")
        object.__setattr__(self, "lines", _owned_sequence(self.lines, str))
        for line in self.lines:
            _text(line, name="line identity", required=True)


@dataclass(frozen=True)
class OutputRef:
    operation: str
    name: str

    def __post_init__(self) -> None:
        _text(self.operation, name="prerequisite operation", required=True)
        _text(self.name, name="prerequisite output", required=True)


@dataclass(frozen=True)
class Output:
    name: str
    model: str
    pk: int
    identity_digest: str

    def __post_init__(self) -> None:
        for name in ("name", "model", "identity_digest"):
            _text(getattr(self, name), name=name, required=True)
        if type(self.pk) is not int or self.pk <= 0:
            raise ValueError("output requires a positive PK and record identity evidence")


@dataclass(frozen=True)
class Effect:
    kind: str
    certainty: Certainty
    model: str = ""
    pk: int | None = None

    def __post_init__(self) -> None:
        _text(self.kind, name="effect kind", required=True)
        _text(self.model, name="effect model")
        object.__setattr__(self, "certainty", Certainty(self.certainty))
        if self.pk is not None and (type(self.pk) is not int or self.pk <= 0 or not self.model):
            raise ValueError("effect PK requires a positive identity and model")


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

    def __post_init__(self) -> None:
        object.__setattr__(self, "kind", Kind(self.kind))
        for name in ("id", "subject", "reconciliation"):
            _text(getattr(self, name), name=name, required=True)
        _text(self.group, name="group")
        if not isinstance(self.desired, Inputs) or not isinstance(self.baseline, Inputs) or not isinstance(self.attribution, Attribution):
            raise ValueError("operation requires typed immutable inputs and attribution")
        if type(self.required) is not bool or type(self.mutation) is not bool:
            raise ValueError("operation permissions must be booleans")
        object.__setattr__(self, "requires", _owned_sequence(self.requires, OutputRef))
        for name in ("provides", "conflicts"):
            owned = _owned_sequence(getattr(self, name), str)
            for value in owned:
                _text(value, name=name, required=True)
            if len(owned) != len(set(owned)):
                raise ValueError(f"duplicate operation {name}")
            object.__setattr__(self, name, owned)

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
        object.__setattr__(self, "state", State(self.state))
        object.__setattr__(self, "certainty", Certainty(self.certainty))
        object.__setattr__(self, "retry", Retry(self.retry))
        object.__setattr__(self, "outputs", _owned_sequence(self.outputs, Output))
        object.__setattr__(self, "effects", _owned_sequence(self.effects, Effect))
        if self.error is not None and not isinstance(self.error, SafeError):
            raise ValueError("operation result requires a typed safe error")
        if has_unknown_effects(self) and self.certainty != Certainty.UNKNOWN:
            raise ValueError("unknown effects require unknown aggregate certainty")
        if any(e.certainty == Certainty.CONFIRMED for e in self.effects) and self.certainty == Certainty.NONE:
            raise ValueError("confirmed effects cannot have no aggregate certainty")
        if self.state in {State.PENDING, State.READY, State.RUNNING}:
            raise ValueError("result must be a settled operation outcome")
        if self.state in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} and (
                self.certainty == Certainty.UNKNOWN or self.retry != Retry.NEVER
                or any(e.certainty == Certainty.UNKNOWN for e in self.effects)):
            raise ValueError("unresolved effects or recovery cannot be a successful outcome")
        if self.certainty == Certainty.UNKNOWN and self.retry not in {Retry.RECONCILE, Retry.REVIEW}:
            raise ValueError("unknown effects require reconciliation or review")
        if len({o.name for o in self.outputs}) != len(self.outputs):
            raise ValueError("duplicate output name")


def has_unknown_effects(result: OperationResult) -> bool:
    return any(effect.certainty == Certainty.UNKNOWN for effect in result.effects)


@dataclass(frozen=True)
class Target:
    endpoint: str
    instance_id: str = ""
    identity_evidence: str = ""

    def __post_init__(self) -> None:
        _text(self.endpoint, name="target endpoint", required=True)
        _text(self.instance_id, name="target instance")
        _text(self.identity_evidence, name="target evidence")


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

    def __post_init__(self) -> None:
        for name in ("import_id", "input_digest", "config_digest"):
            _text(getattr(self, name), name=name, required=True)
        if not isinstance(self.files, Inputs) or not isinstance(self.decisions, Inputs) or not isinstance(self.target, Target):
            raise ValueError("plan requires typed immutable inputs and target")
        if (type(self.schema_version) is not int or self.schema_version != SCHEMA_VERSION
                or type(self.input_version) is not int or self.input_version not in {1, 2}
                or type(self.normalization_version) is not int or self.normalization_version != 1):
            raise ValueError("unsupported execution plan schema")
        object.__setattr__(self, "operations", _owned_sequence(self.operations, OperationSpec))
        object.__setattr__(self, "unsupported", _owned_sequence(self.unsupported, str))

    @property
    def revision(self) -> str:
        return digest(asdict(self))

    def dumps(self) -> str:
        return canonical(asdict(self))

    @classmethod
    def loads(cls, text: str) -> Plan:
        value = _record(json.loads(text, object_pairs_hook=_unique_object), cls)
        operations = []
        if not isinstance(value["operations"], list):
            raise ValueError("plan operations must be an array")
        for serialized in value.pop("operations"):
            raw = _record(serialized, OperationSpec)
            raw["desired"] = Inputs(**_record(raw["desired"], Inputs))
            raw["baseline"] = Inputs(**_record(raw["baseline"], Inputs))
            if not isinstance(raw["requires"], list):
                raise ValueError("prerequisites must be an array")
            raw["requires"] = tuple(OutputRef(**_record(r, OutputRef)) for r in raw["requires"])
            raw["attribution"] = Attribution(**_record(raw["attribution"], Attribution))
            operations.append(OperationSpec(**raw))
        value["files"] = Inputs(**_record(value["files"], Inputs))
        value["decisions"] = Inputs(**_record(value["decisions"], Inputs))
        value["target"] = Target(**_record(value["target"], Target))
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


def execution_eligible(state: State, result: OperationResult | None, *, mutation: bool) -> bool:
    """State is presentation; only a separate safe-read policy permits replay."""
    if state not in {State.PENDING, State.READY, State.BLOCKED, State.RETRY_WAIT}:
        return False
    if result is None:
        return state != State.RETRY_WAIT
    return (not mutation and result.certainty == Certainty.NONE and result.retry == Retry.READ
            and not has_unknown_effects(result))

"""Freeze validated input and explicit discovery choices without inventing handlers.

This Stage 3 preparation record is deliberately non-executable stock work. Stage 4
will turn decisions into domain operation specs with revalidation/reconciliation.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
from pathlib import Path, PurePosixPath
from typing import Callable, Mapping, Protocol

from ..stockfile import StockFile
from .models import Inputs, Plan, Target, digest
from .ownership import normalize_endpoint


class ReadAPI(Protocol):
    def get(self, route: str, *, params: dict) -> object: ...


class ReadOnlyDiscovery:
    """Expose bounded complete reads to one preparation decision callback."""
    def __init__(self, api: ReadAPI):
        self._api = api

    def rows(self, route: str, *, params: dict | None = None) -> list[dict]:
        from ..inventree.collections import list_rows
        return list_rows(self._api, route, params=params)


@dataclass(frozen=True)
class Decision:
    logical_subject: str
    model: str
    pk: int
    identity_digest: str
    reason_code: str

    def __post_init__(self) -> None:
        if any(not isinstance(getattr(self, name), str) or not getattr(self, name)
               for name in ("logical_subject", "model", "identity_digest", "reason_code")):
            raise ValueError("decision identifiers and evidence must be nonempty text")
        if type(self.pk) is not int or self.pk <= 0 or not self.identity_digest:
            raise ValueError("chosen identity requires PK and identity evidence")
        if not self.reason_code or not self.reason_code.replace("_", "").isalnum():
            raise ValueError("decision reason must be a safe code")


@dataclass(frozen=True)
class DiscoverySnapshot:
    decisions: tuple[Decision, ...]
    evidence_digest: str

    def __post_init__(self) -> None:
        if not isinstance(self.evidence_digest, str) or not self.evidence_digest:
            raise ValueError("complete discovery evidence required")
        if not isinstance(self.decisions, (tuple, list)) or any(not isinstance(d, Decision) for d in self.decisions):
            raise ValueError("typed discovery decisions required")
        object.__setattr__(self, "decisions", tuple(self.decisions))
        keys = [(d.logical_subject, d.model) for d in self.decisions]
        if len(keys) != len(set(keys)):
            raise ValueError("conflicting discovery decisions")


def _semantic_input(document: StockFile) -> dict:
    value = asdict(document)
    value.pop("path")
    return value


def freeze_files(base: Path, files: Mapping[str, Path]) -> Inputs:
    hashes = {}
    for reference, path in files.items():
        relative = PurePosixPath(reference)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts or ":" in reference or "\\" in reference:
            raise ValueError("frozen file references must be portable relative paths")
        resolved = path.resolve()
        if not resolved.is_relative_to(base.resolve()):
            raise ValueError("frozen file escapes source directory")
        hashes[reference] = sha256(resolved.read_bytes()).hexdigest()
    return Inputs.freeze(hashes)


def prepare_import(document: StockFile, *, config_semantics: Mapping,
                   target: Target, api: ReadAPI,
                   discover: Callable[[ReadOnlyDiscovery], DiscoverySnapshot],
                   files: Mapping[str, Path] | None = None,
                   selection: Mapping | None = None) -> Plan:
    """Perform read-only discovery and freeze v1/v2 identity/choices for review.

    `config_semantics` and `selection` must contain semantic values, never auth.
    File references are explicit until Stage 5 owns complete artifact staging.
    No callbacks, SDK models, raw responses or source filesystem paths persist.
    The returned plan advertises unsupported domain resolution and cannot execute.
    """
    if document.version not in {1, 2} or not document.file_id:
        raise ValueError("validated stock input identity required")
    seen: set[str] = set()
    sources = {}
    for line in document.lines:
        if not line.id or line.id in seen or (line.part_of and line.part_of not in seen):
            raise ValueError("invalid stock line identity or part_of order")
        seen.add(line.id)
        sources[line.id] = {"stock_key": document.key_for(line),
                            "part_subject": line.part_ref or (sources[line.part_of]["part_subject"] if line.part_of else line.id),
                            "manufacturer_part_subject": line.manufacturer_part_ref,
                            "part_of": line.part_of}
    frozen = freeze_files(document.path.parent if document.path else Path.cwd(), files or {})
    input_digest = digest(_semantic_input(document))
    config_digest = digest(dict(config_semantics))
    Inputs.freeze(selection or {})
    snapshot = discover(ReadOnlyDiscovery(api))
    decisions = Inputs.freeze({"choices": [asdict(d) for d in snapshot.decisions],
                               "discovery_evidence_digest": snapshot.evidence_digest,
                               "selection": dict(selection or {}), "sources": sources})
    return Plan(document.file_id, document.version, input_digest,
                config_digest, frozen,
                Target(normalize_endpoint(target.endpoint), target.instance_id, target.identity_evidence),
                decisions, (), unsupported=("stock_domain_resolution_and_handlers",))


def validate_preparation(plan: Plan, document: StockFile, *, config_semantics: Mapping,
                         target: Target, files: Mapping[str, Path] | None = None) -> None:
    if (document.file_id != plan.import_id or digest(_semantic_input(document)) != plan.input_digest
            or digest(dict(config_semantics)) != plan.config_digest
            or normalize_endpoint(target.endpoint) != normalize_endpoint(plan.target.endpoint)
            or target.instance_id != plan.target.instance_id):
        raise ValueError("prepared input/config/target drift; new reviewed revision required")
    frozen = freeze_files(document.path.parent if document.path else Path.cwd(), files or {})
    if frozen != plan.files:
        raise ValueError("frozen file content drift")

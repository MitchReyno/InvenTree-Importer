"""Keep generated exports separate from local authority and approved inputs."""
from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
from typing import Iterable
from urllib.parse import quote

from ..stockfile import StockFile
from ..util import absolute_url
from .artifacts import RUN_MARKER
from .ownership import JournalError, state_root


class UnsafeOutputError(ValueError):
    """A generated export would replace protected local state or input."""


def _overlaps(left: Path, right: Path) -> bool:
    return left == right or left.is_relative_to(right) or right.is_relative_to(left)


def _registered_directories(*, required: bool) -> tuple[Path, ...]:
    """Read canonical locations without creating or repairing any authority."""
    directory = state_root() / "execution"
    path = directory / "registry.sqlite3"
    if path.is_symlink():
        raise JournalError("canonical registry unsafe")
    if not path.is_file():
        if required or (directory / "registry.initialized").exists():
            raise JournalError("canonical registry missing; output safety cannot be established")
        return ()
    try:
        with closing(sqlite3.connect(f"file:{quote(path.as_posix())}?mode=ro", uri=True)) as connection:
            connection.execute("BEGIN")
            if (connection.execute("PRAGMA quick_check").fetchone() != ("ok",)
                    or connection.execute("PRAGMA user_version").fetchone() != (1,)):
                raise JournalError("canonical registry invalid")
            locations = [Path(row[0]) for row in connection.execute("SELECT location FROM runs")]
        if any(not location.is_absolute() for location in locations):
            raise JournalError("registered run location is not absolute")
        return tuple(location.parent.resolve() for location in locations)
    except sqlite3.Error as exc:
        raise JournalError("registered run locations unavailable") from exc


class GeneratedOutputs:
    """Own one invocation's explicit destinations and protected input identities.

    Validate again before each write: execution can register/mark a new run after
    initial validation. This is an ordinary-process guard, not protection against
    a malicious process racing filesystem rename/symlink replacement.
    """
    def __init__(self, destinations: Iterable[Path], *, inputs: Iterable[Path] = (),
                 directories: Iterable[Path] = (), require_registry: bool = False) -> None:
        self.destinations = tuple(destinations)
        self.inputs = set(inputs)
        self.directories = tuple(directories)
        self.require_registry = require_registry

    def protect(self, paths: Iterable[Path]) -> None:
        self.inputs.update(paths)

    def validate(self) -> None:
        if not self.destinations:
            return
        outputs = tuple(path.resolve() for path in self.destinations)
        for index, output in enumerate(outputs):
            if any(_overlaps(output, other) for other in outputs[index + 1:]):
                raise UnsafeOutputError("generated output destinations overlap")
        roots = (state_root().resolve(), *(path.resolve() for path in self.directories))
        if any(_overlaps(output, root) for output in outputs for root in roots):
            raise UnsafeOutputError("generated output overlaps local authority or configuration")
        # Canonical registration protects the entire run, even if its marker is
        # missing. Markers protect other/custom owned runs not yet registered.
        roots = _registered_directories(required=self.require_registry)
        for output in outputs:
            if (any(_overlaps(output, root) for root in roots)
                    or any((parent / RUN_MARKER).is_file() for parent in (output, *output.parents))):
                raise UnsafeOutputError("generated output overlaps an owned run")
            for source in self.inputs:
                resolved_source = source.resolve()
                if (_overlaps(output, resolved_source)
                        or (output.exists() and source.exists() and output.samefile(source))):
                    raise UnsafeOutputError("generated output overlaps an approved input")


def preparation_source_paths(document: StockFile) -> set[Path]:
    """Local source identities explicitly referenced by validated stock input."""
    base = document.path.parent if document.path else Path.cwd()
    references: list[str] = []
    provenance = list(document.provenance)
    for line in document.lines:
        references.extend([line.image, line.datasheet, *line.images, *line.stock_images,
                           *(source for source, _ in line.attachments)])
        invoice = line.order.get("invoice")
        if invoice:
            references.append(invoice.get("file", "") if isinstance(invoice, dict) else invoice)
        provenance.extend([*line.provenance, *line.part_provenance, *line.manufacturer_part_provenance])
    for company in document.companies.values():
        references.append(company.get("image", ""))
        provenance.extend(company.get("provenance", []))
    references.extend(row.get(key, "") for row in provenance for key in ("file", "snapshot"))
    paths = {Path(reference) if Path(reference).is_absolute() else base / reference
             for reference in references if reference and not absolute_url(reference)}
    if document.path:
        paths.add(document.path)
    return paths

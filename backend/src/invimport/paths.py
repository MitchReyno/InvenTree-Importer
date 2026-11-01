"""Discover the known checkout layout without adopting an unrelated cwd/repository.

Source installs support both the historical flat project and the backend workspace.
An installed wheel has no bundled importer config; retain the previous package-
relative fallback and require explicit config/env paths where that fallback lacks
files. No ancestor/cwd repository search or execution-state migration is performed.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProjectLayout:
    backend: Path
    repository: Path


def discover_layout(package_file: Path | None = None) -> ProjectLayout:
    package_file = (package_file or Path(__file__)).resolve()
    project = package_file.parents[2]
    workspace = project.parent
    known_source = project / "src" / "invimport" / package_file.name
    relocated = (project.name == "backend" and known_source == package_file
                 and (project / "pyproject.toml").is_file()
                 and (workspace / "pnpm-workspace.yaml").is_file()
                 and (workspace / "AGENTS.md").is_file())
    return ProjectLayout(project, workspace if relocated else project)


def default_data_path(relative: Path, *, cwd: Path | None = None,
                      layout: ProjectLayout | None = None) -> Path:
    """Resolve an OMITTED managed default, preserving all explicit arguments.

    Only the backend project cwd is an alias for repository-root local data.
    External working directories keep their original cwd-relative behavior.
    Callers must not pass user-selected paths through this default-only helper.
    """
    layout = layout or discover_layout()
    cwd = (cwd or Path.cwd()).resolve()
    if cwd == layout.backend and layout.backend != layout.repository:
        return layout.repository / relative
    return relative

"""Relocation must preserve configuration and local-data identity without cwd capture."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from invimport import cache, paths
from invimport.config import CONFIG_DIR
from invimport.env import DEFAULT_ENV_FILE
from tests.support import REPO_ROOT


def source_layout(tmp_path):
    backend = tmp_path / "backend"
    module = backend / "src" / "invimport" / "paths.py"
    module.parent.mkdir(parents=True)
    module.touch()
    (backend / "pyproject.toml").touch()
    (tmp_path / "pnpm-workspace.yaml").touch()
    (tmp_path / "AGENTS.md").touch()
    return module, paths.ProjectLayout(backend, tmp_path)


def test_known_worktree_layout_and_config_locations(tmp_path):
    module, expected = source_layout(tmp_path)
    assert paths.discover_layout(module) == expected
    assert DEFAULT_ENV_FILE == REPO_ROOT / ".env"
    assert CONFIG_DIR == REPO_ROOT / "backend" / "config"


def test_flat_source_layout_retains_its_project_root(tmp_path):
    module = tmp_path / "src" / "invimport" / "paths.py"
    module.parent.mkdir(parents=True)
    module.touch()
    assert paths.discover_layout(module) == paths.ProjectLayout(tmp_path, tmp_path)


def test_wheel_does_not_adopt_unrelated_ancestor_workspace(tmp_path, monkeypatch):
    _, layout = source_layout(tmp_path)
    module = tmp_path / "venv" / "lib" / "python3.12" / "site-packages" / "invimport" / "paths.py"
    module.parent.mkdir(parents=True)
    module.touch()
    monkeypatch.chdir(layout.backend)
    fallback = module.parents[2]
    assert paths.discover_layout(module) == paths.ProjectLayout(fallback, fallback)


def test_only_backend_cwd_aliases_omitted_local_data_defaults(tmp_path, monkeypatch):
    _, layout = source_layout(tmp_path)
    monkeypatch.setattr(paths, "discover_layout", lambda: layout)
    monkeypatch.chdir(layout.backend)
    assert cache.default_directory(cache.PRODUCTS_DIR) == layout.repository / cache.PRODUCTS_DIR
    # Explicit relative arguments are passed straight through cache I/O.
    explicit = Path(".cache/custom")
    cache.store(explicit, "key", {"kept": True})
    assert cache.load(explicit, "key") == {"kept": True}
    assert (layout.backend / explicit).is_dir()
    assert not (layout.repository / explicit).exists()
    monkeypatch.chdir(layout.repository)
    assert cache.default_directory(cache.PRODUCTS_DIR) == cache.PRODUCTS_DIR
    external = tmp_path / "external"
    external.mkdir()
    monkeypatch.chdir(external)
    assert cache.default_directory(cache.PRODUCTS_DIR) == cache.PRODUCTS_DIR


@pytest.mark.parametrize("working_directory", ["root", "backend", "external"])
def test_fresh_python_cwd_and_explicit_state_override_remain_unchanged(tmp_path, working_directory):
    external = tmp_path / "external"
    external.mkdir()
    cwd = {"root": REPO_ROOT, "backend": REPO_ROOT / "backend", "external": external}[working_directory]
    state = tmp_path / "state"
    state.mkdir()
    sentinel = state / "untouched"
    sentinel.write_bytes(b"journal identity")
    environment = dict(os.environ, INVIMPORT_STATE_DIR=str(state))
    code = """
import json
from pathlib import Path
from invimport.cache import default_directory, PRODUCTS_DIR
from invimport.env import DEFAULT_ENV_FILE
from invimport.config import CONFIG_DIR
from invimport.execution.ownership import state_root
print(json.dumps(dict(cwd=str(Path.cwd()), env=str(DEFAULT_ENV_FILE), config=str(CONFIG_DIR),
                     cache=str(default_directory(PRODUCTS_DIR)), state=str(state_root()))))
"""
    result = subprocess.run([sys.executable, "-c", code], cwd=cwd, env=environment,
                            capture_output=True, text=True, check=True)
    observed = json.loads(result.stdout)
    assert observed["cwd"] == str(cwd)
    assert observed["env"] == str(REPO_ROOT / ".env")
    assert observed["config"] == str(REPO_ROOT / "backend" / "config")
    assert observed["state"] == str(state)
    expected_cache = REPO_ROOT / cache.PRODUCTS_DIR if working_directory == "backend" else cache.PRODUCTS_DIR
    assert observed["cache"] == str(expected_cache)
    assert sentinel.read_bytes() == b"journal identity"

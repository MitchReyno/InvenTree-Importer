"""The local development InvenTree as the importer's default server."""

from __future__ import annotations

import json
import os

import pytest

from invimport.inventree import local_dev
from invimport.inventree.local_dev import (
    LOCAL_DEV_ORIGIN,
    apply_local_inventree_default,
    development_state_directory,
    read_local_writer_token,
)

WRITER = "inv-" + "a" * 40 + "-20261118"
READER = "inv-" + "b" * 40 + "-20261118"


def write_state(directory, state=None, *, mode=0o600):
    path = directory / local_dev.STATE_FILE_NAME
    content = state if isinstance(state, str) else json.dumps(
        state or {"version": 1, "tokens": {"reader": READER, "writer": WRITER}}
    )
    path.write_text(content, encoding="utf-8")
    path.chmod(mode)
    return path


def apply(environ, directory):
    environ = {"INTAKE_DEV_STATE": str(directory), **environ}
    messages = []
    applied = apply_local_inventree_default(environ, report=messages.append)
    return applied, environ, messages


def test_the_state_directory_follows_the_launcher_rule(tmp_path, monkeypatch):
    assert development_state_directory({"INTAKE_DEV_STATE": str(tmp_path)}) == tmp_path.resolve()
    monkeypatch.setenv("HOME", str(tmp_path))
    assert development_state_directory({}) == tmp_path / ".local/state/bench-intake"


def test_a_ready_local_instance_becomes_the_default_and_the_token_is_never_reported(
    development_state_directory,
):
    write_state(development_state_directory)
    applied, environ, messages = apply({}, development_state_directory)
    assert applied
    assert environ["INVENTREE_URL"] == LOCAL_DEV_ORIGIN == "http://127.0.0.1:4320"
    assert environ["INVENTREE_TOKEN"] == WRITER
    assert messages == [
        "Using the local development InvenTree at http://127.0.0.1:4320 "
        "(no InvenTree server configured)."
    ]
    assert WRITER not in "".join(messages)


def test_empty_settings_count_as_unset(development_state_directory):
    write_state(development_state_directory)
    template = {name: "" for name in local_dev.INVENTREE_SETTINGS}
    applied, environ, _ = apply(template, development_state_directory)
    assert applied
    assert environ["INVENTREE_TOKEN"] == WRITER


@pytest.mark.parametrize(
    "settings",
    [
        {"INVENTREE_URL": "https://inventory.example.invalid", "INVENTREE_TOKEN": "x"},
        {"INVENTREE_URL": "https://inventory.example.invalid"},
        {"INVENTREE_TOKEN": "x"},
        {"INVENTREE_USER": "someone"},
        {"INVENTREE_PASSWORD": "secret"},
    ],
)
def test_any_configured_setting_leaves_the_environment_alone(development_state_directory, settings):
    write_state(development_state_directory)
    applied, environ, messages = apply(dict(settings), development_state_directory)
    assert not applied
    assert messages == []
    assert {k: v for k, v in environ.items() if k.startswith("INVENTREE_")} == settings


def test_no_state_file_means_no_local_instance(development_state_directory):
    applied, environ, messages = apply({}, development_state_directory)
    assert not applied
    assert "INVENTREE_URL" not in environ
    assert messages == []


@pytest.mark.parametrize(
    "state",
    [
        "not json",
        {"version": 2, "tokens": {"writer": WRITER}},
        {"version": 1, "tokens": {"writer": "not-a-token"}},
        {"version": 1},
        {"version": True, "tokens": {"writer": WRITER}},
        {"version": 1.0, "tokens": {"writer": WRITER}},
        {"version": 1, "tokens": {"writer": WRITER + "\n"}},
        '{"version": ' + "9" * 5000 + ', "tokens": {"writer": "' + WRITER + '"}}',
        {"version": 1, "tokens": {"writer": "inv-" + "a" * 40 + "-2026111\u0663"}},
    ],
)
def test_an_invalid_state_file_is_not_used(development_state_directory, state):
    write_state(development_state_directory, state)
    assert read_local_writer_token(development_state_directory) is None


def test_a_state_file_readable_by_others_is_not_used(development_state_directory):
    write_state(development_state_directory, mode=0o644)
    assert read_local_writer_token(development_state_directory) is None


def test_a_symlinked_state_file_is_not_used(development_state_directory, tmp_path):
    real = tmp_path / "elsewhere.json"
    real.write_text(json.dumps({"version": 1, "tokens": {"writer": WRITER}}), encoding="utf-8")
    real.chmod(0o600)
    (development_state_directory / local_dev.STATE_FILE_NAME).symlink_to(real)
    assert read_local_writer_token(development_state_directory) is None


def test_an_oversized_state_file_is_not_used(development_state_directory):
    write_state(development_state_directory, json.dumps({"version": 1, "padding": "x" * 20000}))
    assert read_local_writer_token(development_state_directory) is None


def test_a_state_directory_open_to_others_is_not_used(development_state_directory):
    write_state(development_state_directory)
    development_state_directory.chmod(0o755)
    assert read_local_writer_token(development_state_directory) is None


@pytest.mark.skipif(os.getuid() == 0, reason="root reads files owned by anyone")
def test_a_state_file_owned_by_someone_else_is_not_used(development_state_directory, monkeypatch):
    write_state(development_state_directory)
    real_uid = os.getuid()
    monkeypatch.setattr(local_dev.os, "getuid", lambda: real_uid + 1)
    assert read_local_writer_token(development_state_directory) is None


def test_connect_without_a_server_names_both_ways_to_configure_one(monkeypatch):
    from invimport.inventree.api import InvenTreeNotConfigured, connect

    for name in local_dev.INVENTREE_SETTINGS:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(InvenTreeNotConfigured) as refusal:
        connect()
    assert "INVENTREE_URL" in str(refusal.value)
    assert "pnpm inventree:dev up" in str(refusal.value)


def test_connect_with_a_url_but_no_credentials_refuses_as_before(monkeypatch):
    from invimport.inventree.api import InvenTreeError, InvenTreeNotConfigured, connect

    for name in local_dev.INVENTREE_SETTINGS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("INVENTREE_URL", "https://inventory.example.invalid")
    with pytest.raises(InvenTreeError) as refusal:
        connect()
    assert not isinstance(refusal.value, InvenTreeNotConfigured)
    assert "INVENTREE_TOKEN" in str(refusal.value)


def test_a_copied_template_still_falls_back_to_the_local_instance(
    development_state_directory, monkeypatch, tmp_path
):
    import shutil

    from invimport.env import load_env_file
    from invimport.paths import discover_layout

    from dotenv import dotenv_values

    copied = tmp_path / ".env"
    shutil.copyfile(discover_layout().repository / ".env.example", copied)
    # Register every template key with monkeypatch, so the values loaded below are undone.
    for name in dotenv_values(copied):
        monkeypatch.setenv(name, "")
        monkeypatch.delenv(name)
    load_env_file(copied)
    write_state(development_state_directory)
    messages = []
    assert apply_local_inventree_default(os.environ, report=messages.append)
    assert os.environ["INVENTREE_URL"] == LOCAL_DEV_ORIGIN
    assert len(messages) == 1

"""
Fixtures shared by every test in the project.

Sitting at the top of tests/, this applies to the mirrored suites beneath it
and anything added later. The fakes themselves live in tests/support.py so they
can be imported without going through a fixture.

Nothing here touches the network or the real .cache: the DigiKey fixtures patch
requests.get, and every test that writes a cache runs in a temp working
directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
# src layout: the package lives under src/, and the repo root deliberately is
# not importable as a package root. uv sync installs the project editable, so
# this is only a fallback for running pytest without the project installed.
sys.path.insert(0, str(REPO_ROOT / "src"))

from invimport.digikey import api as digikey_api  # noqa: E402
from tests.support import FakeDigiKey, InvenTreeStub  # noqa: E402


@pytest.fixture
def digikey():
    """Patch the DigiKey transport and token grant; yields the FakeDigiKey."""
    fake = FakeDigiKey()
    with mock.patch.object(digikey_api.requests, "get", fake.get), \
         mock.patch.object(digikey_api, "REQUEST_DELAY_S", 0), \
         mock.patch.object(digikey_api, "get_access_token", lambda *a, **k: "tok"):
        yield fake


@pytest.fixture
def digikey_env(monkeypatch):
    """Credentials in the environment, with any real ones cleared first."""
    for key in [k for k in os.environ if k.startswith("DIGIKEY_")]:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("DIGIKEY_CLIENT_ID", "test-client")
    monkeypatch.setenv("DIGIKEY_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("DIGIKEY_ACCOUNT_ID", "test-account")


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """
    An isolated working directory. Cache paths are relative to the cwd, so this
    keeps tests off the repo's real .cache.
    """
    monkeypatch.chdir(tmp_path)
    return tmp_path


@pytest.fixture
def env_file(tmp_path):
    """A .env holding a full set of DigiKey credentials."""
    path = tmp_path / ".env"
    path.write_text(
        "DIGIKEY_CLIENT_ID=test-client\n"
        "DIGIKEY_CLIENT_SECRET=test-secret\n"
        "DIGIKEY_ACCOUNT_ID=test-account\n"
    )
    return path


@pytest.fixture
def client(digikey, digikey_env):
    """A connected Client backed by the fake transport."""
    return digikey_api.connect(need_account=True)


@pytest.fixture
def inventree(monkeypatch):
    """A running InvenTree stub with INVENTREE_* pointed at it."""
    with InvenTreeStub() as stub:
        for key in [k for k in os.environ if k.startswith("INVENTREE_")]:
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("INVENTREE_URL", stub.url)
        monkeypatch.setenv("INVENTREE_TOKEN", "test-token")
        yield stub

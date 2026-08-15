"""
.env loading.

Parsing is python-dotenv's; what these pin down is the behaviour this project
depends on - precedence, the return count, and that the formats already in use
keep working.
"""

from __future__ import annotations

import os

import pytest

from invimport.env import DEFAULT_ENV_FILE, load_env_file


@pytest.fixture
def clean_env(monkeypatch):
    """No DIGIKEY_/INVENTREE_ variables leaking in from the real environment."""
    for key in list(os.environ):
        if key.startswith(("DIGIKEY_", "INVENTREE_", "SAMPLE_")):
            monkeypatch.delenv(key, raising=False)


def write(tmp_path, text):
    path = tmp_path / ".env"
    path.write_text(text)
    return path


# --------------------------------------------------------------------------
# Precedence - the rule the CLI documents
# --------------------------------------------------------------------------
def test_values_are_loaded_into_the_environment(tmp_path, clean_env):
    assert load_env_file(write(tmp_path, "DIGIKEY_CLIENT_ID=abc\n")) == 1
    assert os.environ["DIGIKEY_CLIENT_ID"] == "abc"


def test_real_environment_wins(tmp_path, clean_env, monkeypatch):
    """Exporting a variable must still beat the file, for one-off runs."""
    monkeypatch.setenv("DIGIKEY_CLIENT_ID", "exported")
    assert load_env_file(write(tmp_path, "DIGIKEY_CLIENT_ID=from-file\n")) == 0
    assert os.environ["DIGIKEY_CLIENT_ID"] == "exported"


def test_count_reflects_only_what_was_taken(tmp_path, clean_env, monkeypatch):
    monkeypatch.setenv("DIGIKEY_CLIENT_ID", "exported")
    count = load_env_file(write(
        tmp_path, "DIGIKEY_CLIENT_ID=ignored\nDIGIKEY_CLIENT_SECRET=taken\n"))
    assert count == 1


def test_missing_file_is_not_an_error(tmp_path, clean_env):
    assert load_env_file(tmp_path / "nope.env") == 0


def test_empty_file_loads_nothing(tmp_path, clean_env):
    assert load_env_file(write(tmp_path, "")) == 0


# --------------------------------------------------------------------------
# Formats this project's .env files actually use
# --------------------------------------------------------------------------
def test_comments_and_blank_lines_are_skipped(tmp_path, clean_env):
    count = load_env_file(write(tmp_path, """
# Local environment variables
DIGIKEY_CLIENT_ID=abc

  # indented comment
DIGIKEY_CLIENT_SECRET=def
"""))
    assert count == 2
    assert os.environ["DIGIKEY_CLIENT_SECRET"] == "def"


def test_export_prefix_is_tolerated(tmp_path, clean_env):
    """The docstrings used to suggest `export FOO=bar`, so it must still work."""
    assert load_env_file(write(tmp_path, "export DIGIKEY_CLIENT_ID=abc\n")) == 1
    assert os.environ["DIGIKEY_CLIENT_ID"] == "abc"


@pytest.mark.parametrize("line,expected", [
    ("SAMPLE_V=plain", "plain"),
    ('SAMPLE_V="double quoted"', "double quoted"),
    ("SAMPLE_V='single quoted'", "single quoted"),
    ("SAMPLE_V=  surrounded-by-space  ", "surrounded-by-space"),
    ("SAMPLE_V=", ""),
    ("SAMPLE_V=has=equals=signs", "has=equals=signs"),
    ("SAMPLE_V=trailing#hash", "trailing#hash"),
])
def test_value_forms(tmp_path, clean_env, line, expected):
    load_env_file(write(tmp_path, line + "\n"))
    assert os.environ["SAMPLE_V"] == expected


def test_a_key_with_no_value_is_skipped(tmp_path, clean_env):
    """A bare key has nothing to assign; it must not become an empty string."""
    assert load_env_file(write(tmp_path, "SAMPLE_V\n")) == 0
    assert "SAMPLE_V" not in os.environ


def test_secrets_with_awkward_characters_survive(tmp_path, clean_env):
    """Real credentials contain punctuation; none of it should be mangled."""
    secret = "aB3$xY/z+9=~!@%^&*()_-"
    load_env_file(write(tmp_path, f"SAMPLE_V='{secret}'\n"))
    assert os.environ["SAMPLE_V"] == secret


@pytest.mark.parametrize("line", [
    "SAMPLE_V=secret${NOT_SET}tail",
    "SAMPLE_V='secret${NOT_SET}tail'",
    'SAMPLE_V="secret${NOT_SET}tail"',
])
def test_dollar_brace_in_a_secret_is_left_alone(tmp_path, clean_env, line):
    """
    Interpolation is disabled, so a secret containing ${ passes through intact.

    With it on there is no escape: every quoting style expands, and an unset
    name collapses to empty - corrupting the credential silently.
    """
    load_env_file(write(tmp_path, line + "\n"))
    assert os.environ["SAMPLE_V"] == "secret${NOT_SET}tail"


def test_a_set_variable_is_not_expanded_either(tmp_path, clean_env, monkeypatch):
    monkeypatch.setenv("SAMPLE_HOST", "example.com")
    load_env_file(write(tmp_path, "SAMPLE_V=https://${SAMPLE_HOST}/api\n"))
    assert os.environ["SAMPLE_V"] == "https://${SAMPLE_HOST}/api"


# --------------------------------------------------------------------------
# Default location
# --------------------------------------------------------------------------
def test_default_env_file_is_the_repo_root():
    assert DEFAULT_ENV_FILE.name == ".env"
    assert DEFAULT_ENV_FILE.parent.name == "InvenTree-Importer"
    assert "site-packages" not in str(DEFAULT_ENV_FILE)

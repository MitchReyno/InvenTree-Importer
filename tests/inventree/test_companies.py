"""Finding companies with no logo, and giving them one."""

from __future__ import annotations

import json

import pytest

from invimport.__main__ import main
from invimport.inventree.api import connect
from invimport.inventree.companies import (
    FAILED,
    HAS_ONE,
    NOT_FOUND,
    SET,
    WOULD_SET,
    missing_logos,
    set_logos,
)


@pytest.fixture(autouse=True)
def no_real_env(tmp_path, monkeypatch):
    """The CLI tests must not load the developer's real .env."""
    monkeypatch.setattr("invimport.__main__.DEFAULT_ENV_FILE",
                        tmp_path / "absent.env")


@pytest.fixture
def server(inventree):
    inventree.add_company("YAGEO", pk=1, is_manufacturer=True,
                          is_supplier=False)
    inventree.add_company("Rockby Electronics", pk=2,
                          image="/media/company_images/rockby.png")
    inventree.add_company("Signetics", pk=3, is_manufacturer=True,
                          is_supplier=False)
    return inventree


@pytest.fixture
def logo(tmp_path):
    path = tmp_path / "logo.png"
    path.write_bytes(b"\x89PNG\r\n\x1a\n")
    return path


def test_only_companies_without_an_image_are_missing_one(server):
    assert [c.name for c in missing_logos(connect())] == ["Signetics",
                                                          "YAGEO"]


def test_a_logo_is_set_through_a_learned_alias(server, logo):
    actions = set_logos(connect(), {"Yageo Corp": {"image": str(logo)}},
                        write=True, aliases={"YAGEO": ["Yageo Corp"]})
    assert (actions[0].action, actions[0].company) == (SET, "YAGEO")
    assert server.company_images == [1]


def test_a_dry_run_uploads_nothing(server, logo):
    actions = set_logos(connect(), {"YAGEO": {"image": str(logo)}})
    assert actions[0].action == WOULD_SET
    assert server.company_images == []


def test_an_existing_logo_is_never_replaced(server, logo):
    actions = set_logos(connect(), {"Rockby": {"image": str(logo)}},
                        write=True)
    assert actions[0].action == HAS_ONE
    assert server.company_images == []


def test_an_unknown_company_and_a_missing_file_are_reported(server, tmp_path):
    actions = set_logos(connect(), {
        "Fairchild": {"image": "logo.png"},
        "Signetics": {"image": "no-such-file.png"},
    }, write=True, base_dir=tmp_path)
    assert [a.action for a in actions] == [NOT_FOUND, FAILED]
    assert server.company_images == []


def test_the_command_lists_companies_without_a_logo(server, tmp_path, capsys):
    out = tmp_path / "missing.json"
    assert main(["company-logos", "--json", str(out)]) == 0
    rows = json.loads(out.read_text())
    assert [r["name"] for r in rows] == ["Signetics", "YAGEO"]
    assert "2 companies with no logo" in capsys.readouterr().out


def test_the_command_applies_a_logos_file(server, logo, tmp_path, capsys):
    path = tmp_path / "logos.yaml"
    path.write_text("companies:\n  Signetics:\n    image: logo.png\n")
    assert main(["company-logos", str(path)]) == 0
    assert server.company_images == []
    assert main(["company-logos", str(path), "--write"]) == 0
    assert server.company_images == [3]
    assert "1 set" in capsys.readouterr().out


def test_a_logo_set_from_a_file_keeps_where_it_came_from(server, logo,
                                                         tmp_path):
    path = tmp_path / "logos.json"
    path.write_text(json.dumps({"companies": {"Signetics": {
        "image": "logo.png",
        "provenance": [{"kind": "databook",
                        "title": "1981 Signetics Logic Data Book",
                        "pages": "1", "facts": ["image"]}]}}}))
    assert main(["company-logos", str(path), "--write"]) == 0
    doc, = [json.loads(a["contents"]) for a in server.attachments
            if a["filename"].startswith("provenance-")]
    assert doc["record"] == {"model": "company", "pk": 3}
    assert doc["changes"][0]["what"] == "image set"
    assert doc["values"]["image"]["sha256"]
    assert doc["provenance"][0]["title"] == "1981 Signetics Logic Data Book"
    assert main(["company-logos", str(path)]) == 0     # dry run: nothing new
    assert len([a for a in server.attachments
                if a["filename"].startswith("provenance-")]) == 1

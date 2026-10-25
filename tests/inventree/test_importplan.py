"""
The import plan: what `import-stock --plan` records about each line's
relation to the server, built from LineActions and a few reads.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from invimport.inventree.importplan import build_plan, write_plan
from invimport.inventree.parts import UNRESOLVED_PK
from invimport.inventree.stockimport import CREATED, EXISTS, NOTES_KEPT, LineAction


class FakeApi:
    """Serves part, stock and stock-list routes; records downloads."""

    def __init__(self):
        self.gets = []
        self.downloads = []

    def get(self, route, params=None):
        self.gets.append(route)
        if route == "part/590/":
            return {"pk": 590, "IPN": "IC-00126", "name": "JM38510/07801BJA",
                    "image": "/media/part_images/x.jpg",
                    "category_path": [{"name": "Integrated Circuits"},
                                      {"name": "Logic"}]}
        if route == "stock/":
            return [{"pk": 701, "quantity": 63.0, "batch": "", "packaging": "Foil bag",
                     "location_detail": {"pathstring": "Bin 1"}}]
        if route == "stock/800/":
            return {"pk": 800, "part": 590, "quantity": 2.0, "batch": "A",
                    "location_detail": {"pathstring": "Bin 2"}}
        raise AssertionError(f"unexpected route {route}")

    def downloadFile(self, url, destination):
        self.downloads.append(url)
        Path(destination).write_bytes(b"jpeg")


def document():
    return SimpleNamespace(path=Path("/x/imp.json"), file_id="imp")


def test_missing_location_is_blank():
    action = LineAction(id="l01", location=None)
    entry = build_plan(FakeApi(), document(), SimpleNamespace(lines=[action]),
                       image_dir=None)["lines"][0]
    assert entry["location"] == "" and not entry["new_location"]


def test_new_part_line_reads_nothing(tmp_path):
    api = FakeApi()
    action = LineAction(id="l01", quantity=1, ipn="IC-1", name="NEW",
                        part=UNRESOLVED_PK)
    plan = build_plan(api, document(), SimpleNamespace(lines=[action]),
                      image_dir=tmp_path / "img")
    entry, = plan["lines"]
    assert entry["part"] == {"pk": None, "exists": False}
    assert entry["existing_part"] is None and entry["stock_item"] is None
    assert api.gets == []


def test_existing_part_line(tmp_path):
    api = FakeApi()
    action = LineAction(id="l31", quantity=1, part=590, manufacturer_part=567,
                        supplier_part=UNRESOLVED_PK,
                        location="Bin 1", part_notes=NOTES_KEPT)
    plan = build_plan(api, document(), SimpleNamespace(lines=[action, action]),
                      image_dir=tmp_path / "plan-images")
    entry = plan["lines"][0]
    assert entry["manufacturer_part"] == {"pk": 567, "exists": True}
    assert entry["supplier_part"] == {"pk": None, "exists": False}
    assert entry["part_notes_kept"] and not entry["new_location"]
    part = entry["existing_part"]
    assert part["category"] == "Integrated Circuits/Logic"
    assert part["image"] == "plan-images/part-590.jpg"
    assert part["stock"] == [{"pk": 701, "quantity": 63.0, "batch": "",
                              "packaging": "Foil bag", "location": "Bin 1"}]
    # each existing record is read once, however many lines touch it
    assert api.gets.count("part/590/") == 1 and len(api.downloads) == 1


def test_new_location_and_already_imported(tmp_path):
    api = FakeApi()
    new_loc = LineAction(id="l02", action=CREATED, location="Box 9 (new location)")
    done = LineAction(id="l03", action=EXISTS, stock_item=800)
    plan = build_plan(api, document(), SimpleNamespace(lines=[new_loc, done]),
                      image_dir=None)
    first, second = plan["lines"]
    assert first["location"] == "Box 9" and first["new_location"]
    assert second["stock_item"]["location"] == "Bin 2"
    # the part is found through the stock item when the line stopped at its barcode
    assert second["existing_part"]["pk"] == 590
    assert second["existing_part"]["image"] == ""     # no image dir, no download


def test_write_plan_one_or_several(tmp_path):
    one = tmp_path / "one.json"
    write_plan(one, [{"file_id": "a"}])
    assert json.loads(one.read_text()) == {"file_id": "a"}
    two = tmp_path / "two.json"
    write_plan(two, [{"file_id": "a"}, {"file_id": "b"}])
    assert [p["file_id"] for p in json.loads(two.read_text())] == ["a", "b"]

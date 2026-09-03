"""
The register-scans script: framing, and the Textual UI via a headless Pilot.

The TUI lives in scripts/register-scans.py (a hyphen, so it is loaded by path)
and talks to real radios on mount. Tests pass live=False and inject devices
as messages, so nothing here needs a scanner attached. The TUI tests skip if
the scanner extra is not installed; the framing tests always run.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "register-scans.py"
SKIP_TUI = pytest.mark.skipif(
    importlib.util.find_spec("textual") is None,
    reason="scanner extra not installed (uv sync --extra scanner)",
)

SCANNER_ADDR = "FFD28074-E5B0-4A73-A02D-535D7E1FA780"
SCANNER_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"


@pytest.fixture(scope="module")
def rs():
    spec = importlib.util.spec_from_file_location("register_scans", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["register_scans"] = mod
    spec.loader.exec_module(mod)
    return mod


def app_opts(tmp_path, **over):
    opts = dict(
        baud=9600, reconnect=False, timeout=1.0,
        characteristic=None, name=None, address=None, port=None,
        live=False,
        config_path=tmp_path / "scanners.yaml",
    )
    opts.update(over)
    return opts


# --------------------------------------------------------------------------
# Framing — no Textual, no radio
# --------------------------------------------------------------------------
def test_a_terminator_ends_a_scan(rs):
    buf = rs.ScanBuffer()
    assert buf.feed(b"hello\r") == ["hello"]
    assert buf.feed(b"") == []


def test_crlf_does_not_leave_an_empty_scan(rs):
    buf = rs.ScanBuffer()
    assert buf.feed(b"hello\r\n") == ["hello"]


def test_a_scan_split_across_reads_is_reassembled(rs):
    buf = rs.ScanBuffer()
    assert buf.feed(b"hel") == []
    assert buf.feed(b"lo\r") == ["hello"]


def test_idle_flushes_a_scan_with_no_terminator(rs):
    buf = rs.ScanBuffer(gap=0)
    buf.feed(b"no-cr")
    assert buf.idle() == ["no-cr"]
    assert buf.idle() == []


def test_printable_escapes_gs_and_leaves_text_alone(rs):
    assert rs.printable("abc") == "abc"
    assert rs.printable("a\x1db") == "a\\x1db"


def test_short_uuid_collapses_the_bluetooth_base(rs):
    assert rs.short_uuid("0000fff0-0000-1000-8000-00805f9b34fb") == "fff0"
    assert rs.short_uuid("6e400003-b5a3-f393-e0a9-e50e24dcca9e") == (
        "6e400003-b5a3-f393-e0a9-e50e24dcca9e")


def test_found_matches_is_case_insensitive(rs):
    device = rs.Found(kind="ble", key="ble:x", label="C barcode scanner",
                      detail="fff0")
    assert device.matches("BARCODE")
    assert not device.matches("serial")


def test_pick_notify_prefers_a_known_uart(rs):
    known = SimpleNamespace(
        uuid="0000ffe1-0000-1000-8000-00805f9b34fb",
        properties=["notify"], description="UART")
    other = SimpleNamespace(
        uuid="0000aaa1-0000-1000-8000-00805f9b34fb",
        properties=["notify"], description="other")
    client = SimpleNamespace(services=[SimpleNamespace(
        characteristics=[other, known])])
    assert rs.pick_notify(client, None) == known.uuid


def test_pick_notify_with_several_unknowns_is_a_config_error(rs):
    chars = [
        SimpleNamespace(uuid=f"0000aaa{n}-0000-1000-8000-00805f9b34fb",
                        properties=["notify"], description="x")
        for n in (1, 2)
    ]
    client = SimpleNamespace(services=[SimpleNamespace(characteristics=chars)])
    with pytest.raises(rs.ConfigError, match="Several characteristics"):
        rs.pick_notify(client, None)


def test_format_gatt_lists_services_and_properties(rs):
    char = SimpleNamespace(
        uuid="0000fff1-0000-1000-8000-00805f9b34fb",
        properties=["notify", "read"], description="TX")
    service = SimpleNamespace(
        uuid="0000fff0-0000-1000-8000-00805f9b34fb",
        description="UART", characteristics=[char])
    body = rs.format_gatt(SimpleNamespace(services=[service]))
    assert "fff0" in body
    assert "notify,read" in body
    assert "TX" in body


# --------------------------------------------------------------------------
# Config store — no Textual, no radio
# --------------------------------------------------------------------------
def test_default_config_path_is_absolute_and_outside_the_repo(rs):
    path = rs.default_config_path()
    assert path.is_absolute()
    repo = Path(__file__).resolve().parents[1]
    assert path != repo / path.name
    assert repo not in path.parents


def test_config_path_honours_the_environment(rs, tmp_path, monkeypatch):
    target = tmp_path / "custom" / "scanners.yaml"
    monkeypatch.setenv(rs.CONFIG_ENV, str(target))
    assert rs.default_config_path() == target


def test_store_round_trips_a_scanner(rs, tmp_path):
    path = tmp_path / "scanners.yaml"
    store = rs.ScannerStore(path)
    store.put(rs.SavedScanner(
        key=f"ble:{SCANNER_ADDR}", kind="ble", label="C barcode scanner",
        address=SCANNER_ADDR, auto_connect=True, reconnect=False,
        baud=19200, characteristic="fff1"))
    again = rs.ScannerStore(path)
    again.load()
    saved = again.get(f"ble:{SCANNER_ADDR}")
    assert saved is not None
    assert saved.label == "C barcode scanner"
    assert saved.auto_connect is True
    assert saved.reconnect is False
    assert saved.baud == 19200
    assert saved.characteristic == "fff1"
    again.forget(saved.key)
    third = rs.ScannerStore(path)
    third.load()
    assert third.get(saved.key) is None


def test_pending_import_omits_blank_fields(rs):
    doc = rs.pending_import_document(
        [rs.PendingStock(id="s01", barcode="123456", quantity="25",
                         manufacturer="Yageo", notes=""),
         rs.PendingStock(id="s02", barcode="999", quantity="1.5")],
        reference="scan-create-test", captured="2026-09-03")
    assert doc["version"] == 1
    assert doc["source"]["kind"] == "scanner"
    assert doc["source"]["reference"] == "scan-create-test"
    assert doc["lines"][0] == {
        "id": "s01", "sku": "123456", "quantity": 25,
        "manufacturer": "Yageo", "needs_review": True,
    }
    assert doc["lines"][1]["quantity"] == 1.5
    assert "manufacturer" not in doc["lines"][1]
    assert "notes" not in doc["lines"][0]


# --------------------------------------------------------------------------
# TUI
# --------------------------------------------------------------------------
def status_text(app) -> str:
    widget = app.query_one("#status")
    content = getattr(widget, "_content", None)
    if content is not None:
        return str(content)
    return str(widget.render())


def log_text(app) -> str:
    return "\n".join(app.query_one("#scans").lines)


def pretty_text(app) -> str:
    from invimport.inventree.stock import hit_markdown
    if app._current_hit is None:
        return ""
    return hit_markdown(app._current_hit)


def see_ble(app, ui, *, address=SCANNER_ADDR, name="C barcode scanner",
            rssi=-50, uuids=(SCANNER_UUID,)):
    device = SimpleNamespace(address=address, name=name)
    advert = SimpleNamespace(rssi=rssi, service_uuids=list(uuids))
    app.post_message(ui.BleSeen(device, advert))


def fake_session_app(ui):
    """Connects without a radio: the session worker reports connected and
    holds until disconnect cancels it."""

    class FakeSession(ui.ScannerApp):
        async def _ble_loop(self, device):
            self.post_message(ui.LinkState(
                f"connected to {device.label} on fff1", "connected"))
            while self._want_session:
                await asyncio.sleep(0.05)

        def _serial_loop(self, device, baud):
            self.post_message(ui.LinkState(
                f"listening on {device.port} at {baud} baud", "connected"))
            # Bounded wait so a forgotten disconnect cannot hang pytest.
            self._thread_stop.wait(timeout=2)

    return FakeSession


@pytest.fixture
def ui(rs):
    pytest.importorskip("textual")
    return rs.tui()


@pytest.fixture
def opts(tmp_path):
    def make(**over):
        return app_opts(tmp_path, **over)
    return make


@SKIP_TUI
async def test_compose_seeds_settings_from_the_constructor(ui, opts):
    app = ui.ScannerApp(**opts(
        baud=19200, reconnect=True,
        characteristic="0000fff1-0000-1000-8000-00805f9b34fb"))
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.query_one("#baud").value == "19200"
        assert app.query_one("#reconnect").value is True
        assert app.query_one("#auto").value is False
        assert app.query_one("#nearby") is not None
        assert app.query_one("#remembered") is not None
        assert app.query_one("#characteristic").value.startswith("0000fff1")
        assert app.phase == "scanning"
        assert "scanning" in status_text(app)


@SKIP_TUI
async def test_r_and_u_toggle_the_settings_switches(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("r")
        assert app.query_one("#reconnect").value is True
        await pilot.press("r")
        assert app.query_one("#reconnect").value is False
        await pilot.press("u")
        assert app.query_one("#unnamed").value is True


@SKIP_TUI
async def test_unnamed_ble_devices_are_hidden_until_toggled(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui, name=None)
        await pilot.pause()
        table = app.query_one("#nearby")
        assert table.row_count == 0
        app.query_one("#nearby").focus()
        await pilot.press("u")
        await pilot.pause()
        assert table.row_count == 1
        assert app.selected_device().label == "(no name)"


@SKIP_TUI
async def test_filter_keeps_only_matching_devices(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui, name="C barcode scanner")
        see_ble(app, ui, address="AAA", name="Samsung TV", rssi=-86,
                uuids=())
        await pilot.pause()
        table = app.query_one("#nearby")
        assert table.row_count == 2
        app.query_one("#filter").focus()
        await pilot.press("b", "a", "r")
        await pilot.pause()
        assert table.row_count == 1
        assert app.selected_device().label == "C barcode scanner"


@SKIP_TUI
async def test_a_serial_snapshot_adds_a_port_and_drops_it_when_gone(ui, opts):
    app = ui.ScannerApp(**opts())
    port = SimpleNamespace(device="/dev/cu.Cbarcodescanner",
                           description="C barcode scanner")
    async with app.run_test() as pilot:
        await pilot.pause()
        app.post_message(ui.SerialSnapshot([port]))
        await pilot.pause()
        table = app.query_one("#nearby")
        assert table.row_count == 1
        assert app.selected_device().port == port.device
        app.post_message(ui.SerialSnapshot([]))
        await pilot.pause()
        assert table.row_count == 0


@SKIP_TUI
async def test_s_clears_stale_ble_devices(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        assert app.query_one("#nearby").row_count == 1
        app.query_one("#nearby").focus()
        await pilot.press("s")
        await pilot.pause()
        assert app.query_one("#nearby").row_count == 0


@SKIP_TUI
async def test_scans_land_in_the_log_and_the_status_count(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.post_message(ui.LinkState("connected to C barcode scanner",
                                      "connected"))
        await pilot.pause()
        app.post_message(ui.ScanArrived("hello"))
        app.post_message(ui.ScanArrived("a\x1db"))
        await pilot.pause()
        assert app.scan_count == 2
        body = log_text(app)
        assert "hello" in body
        assert "a\\x1db" in body
        assert "2 scans" in status_text(app)
        app.query_one("#nearby").focus()
        await pilot.press("x")
        await pilot.pause()
        assert app.scan_count == 0
        assert log_text(app).strip() == ""


@SKIP_TUI
async def test_c_connects_a_serial_port(ui, opts):
    app = fake_session_app(ui)(**opts())
    port = SimpleNamespace(device="/dev/cu.Cbarcodescanner",
                           description="C barcode scanner")
    async with app.run_test() as pilot:
        await pilot.pause()
        app.post_message(ui.SerialSnapshot([port]))
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        assert app.phase == "connected"
        assert app.connected_key == "serial:/dev/cu.Cbarcodescanner"
        assert "listening" in app.status_text
        await pilot.press("d")
        await pilot.pause()


@SKIP_TUI
async def test_c_connects_the_selected_ble_device(ui, opts):
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        assert app.phase == "connected"
        assert app.connected_key == f"ble:{SCANNER_ADDR}"
        assert "C barcode scanner" in app.status_text


@SKIP_TUI
async def test_connect_stops_the_ble_scan_without_crashing(ui, opts):
    """Regression: Textual 8 cancel_group(self, group), not cancel_group(group)."""
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        assert app.phase == "connected"


@SKIP_TUI
async def test_d_disconnects_and_clears_the_connected_marker(ui, opts):
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        await pilot.press("d")
        await pilot.pause()
        assert app.connected_key is None
        assert app.phase == "scanning"
        assert "disconnected" in app.status_text


@SKIP_TUI
async def test_connecting_a_second_device_asks_to_disconnect_first(ui, opts):
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        see_ble(app, ui, address="OTHER", name="other scanner")
        await pilot.pause()
        # The connected row is still selected; connecting a different one
        # is refused rather than tearing the current link down.
        notifications = []
        original = app.notify

        def capture(message, **kwargs):
            notifications.append(message)
            return original(message, **kwargs)

        app.notify = capture
        # Move to the other row if it is visible, then try connect.
        table = app.query_one("#nearby")
        if table.row_count > 1:
            table.move_cursor(row=1)
        await pilot.press("c")
        await pilot.pause()
        assert app.phase == "connected"
        assert app.connected_key == f"ble:{SCANNER_ADDR}"
        assert any("Disconnect first" in n for n in notifications)


@SKIP_TUI
async def test_g_opens_a_gatt_dump_of_the_connected_client(ui, opts):
    app = ui.ScannerApp(**opts())
    char = SimpleNamespace(
        uuid="0000fff1-0000-1000-8000-00805f9b34fb",
        properties=["notify"], description="TX")
    service = SimpleNamespace(
        uuid=SCANNER_UUID, description="UART", characteristics=[char])
    app._ble_client = SimpleNamespace(services=[service])
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("g")
        await pilot.pause()
        assert isinstance(app.screen, ui.GattScreen)
        body = "\n".join(app.screen.query_one("#gatt-body").lines)
        assert "UART" in body
        await pilot.press("escape")
        await pilot.pause()
        assert not isinstance(app.screen, ui.GattScreen)


@SKIP_TUI
async def test_name_auto_connects_when_the_device_appears(ui, opts):
    app = fake_session_app(ui)(**opts(name="barcode"))
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui, name="C barcode scanner")
        await pilot.pause(0.2)
        assert app.phase == "connected"
        assert app.connected_key == f"ble:{SCANNER_ADDR}"


@SKIP_TUI
async def test_error_state_clears_the_connected_marker(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.connected_key = f"ble:{SCANNER_ADDR}"
        app.rebuild_table()
        app.post_message(ui.LinkState("scanner disconnected", "error"))
        await pilot.pause()
        assert app.phase == "error"
        assert app.connected_key is None
        assert "error" in app.query_one("#status").classes


@SKIP_TUI
async def test_c_with_no_device_does_not_crash(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause()
        assert app.phase == "scanning"


@SKIP_TUI
async def test_connecting_remembers_the_scanner(ui, opts):
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        remembered = app.query_one("#remembered")
        nearby = app.query_one("#nearby")
        assert remembered.row_count == 1
        assert nearby.row_count == 0
        assert app.store.get(f"ble:{SCANNER_ADDR}") is not None


@SKIP_TUI
async def test_remembered_scanner_survives_a_new_session(ui, opts, tmp_path):
    first = fake_session_app(ui)(**opts())
    async with first.run_test() as pilot:
        await pilot.pause()
        see_ble(first, ui)
        await pilot.pause()
        first.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        assert first.store.get(f"ble:{SCANNER_ADDR}") is not None

    second = ui.ScannerApp(**opts())
    async with second.run_test() as pilot:
        await pilot.pause()
        remembered = second.query_one("#remembered")
        nearby = second.query_one("#nearby")
        assert remembered.row_count == 1
        assert nearby.row_count == 0
        saved = second.store.get(f"ble:{SCANNER_ADDR}")
        assert saved is not None
        assert saved.label == "C barcode scanner"
        second.query_one("#remembered").focus()
        await pilot.pause()
        assert second.device_status(saved.key) == "offline"


@SKIP_TUI
async def test_remembered_serial_stays_listed_when_the_port_vanishes(ui, opts):
    app = fake_session_app(ui)(**opts())
    port = SimpleNamespace(device="/dev/cu.Cbarcodescanner",
                           description="C barcode scanner")
    async with app.run_test() as pilot:
        await pilot.pause()
        app.post_message(ui.SerialSnapshot([port]))
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        await pilot.press("d")
        await pilot.pause()
        app.post_message(ui.SerialSnapshot([]))
        await pilot.pause()
        assert app.query_one("#remembered").row_count == 1
        assert app.query_one("#nearby").row_count == 0
        assert app.device_status("serial:/dev/cu.Cbarcodescanner") == "offline"


@SKIP_TUI
async def test_rescan_does_not_drop_remembered_ble(ui, opts):
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        await pilot.press("d")
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("s")
        await pilot.pause()
        assert app.query_one("#remembered").row_count == 1


@SKIP_TUI
async def test_auto_connect_connects_when_the_device_appears(ui, opts, rs):
    path = opts()["config_path"]
    store = rs.ScannerStore(path)
    store.put(rs.SavedScanner(
        key=f"ble:{SCANNER_ADDR}", kind="ble", label="C barcode scanner",
        address=SCANNER_ADDR, auto_connect=True))
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.query_one("#remembered").row_count == 1
        see_ble(app, ui)
        await pilot.pause(0.2)
        assert app.phase == "connected"
        assert app.connected_key == f"ble:{SCANNER_ADDR}"


@SKIP_TUI
async def test_a_toggles_auto_connect_and_persists(ui, opts):
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        app.query_one("#remembered").focus()
        await pilot.pause()
        await pilot.press("a")
        await pilot.pause()
        saved = app.store.get(f"ble:{SCANNER_ADDR}")
        assert saved is not None
        assert saved.auto_connect is True
        assert app.query_one("#auto").value is True


@SKIP_TUI
async def test_f_forgets_a_remembered_scanner(ui, opts):
    app = fake_session_app(ui)(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        see_ble(app, ui)
        await pilot.pause()
        app.query_one("#nearby").focus()
        await pilot.press("c")
        await pilot.pause(0.2)
        await pilot.press("d")
        await pilot.pause()
        app.query_one("#remembered").focus()
        await pilot.press("f")
        await pilot.pause()
        assert app.query_one("#remembered").row_count == 0
        assert app.store.get(f"ble:{SCANNER_ADDR}") is None
        # Still advertising, so it returns to Nearby.
        see_ble(app, ui)
        await pilot.pause()
        assert app.query_one("#nearby").row_count == 1


# --------------------------------------------------------------------------
# Lookup tab
# --------------------------------------------------------------------------
def _hits(*items):
    from invimport.inventree.stock import BarcodeHit
    table = {}
    for scan, kind, pk, payload in items:
        table[scan] = BarcodeHit(kind=kind, pk=pk, payload=payload, scan=scan)
    return table.get


async def on_tab(pilot, key):
    await pilot.press(key)
    await pilot.pause()


@SKIP_TUI
async def test_lookup_tab_is_separate_from_connections(ui, opts):
    app = ui.ScannerApp(**opts())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.query_one("#nearby") is not None
        assert app.query_one("#lookup-md") is not None
        app.query_one("#nearby").focus()
        await pilot.press("2")
        await pilot.pause()
        assert app.query_one("#views").active == "view-lookup"
        await pilot.press("1")
        await pilot.pause()
        assert app.query_one("#views").active == "view-connections"
        await pilot.press("3")
        await pilot.pause()
        assert app.query_one("#views").active == "view-scanin"
        await pilot.press("4")
        await pilot.pause()
        assert app.query_one("#views").active == "view-create"
        await pilot.press("5")
        await pilot.pause()
        assert app.query_one("#views").active == "view-keyboard"


@SKIP_TUI
async def test_a_part_scan_shows_details_and_opens_inventree(ui, opts):
    opened = []
    lookup = _hits((
        "PART-4", "part", 4,
        {"pk": 4, "name": "NE555P", "IPN": "NE555P", "description": "timer",
         "category_detail": {"pathstring": "ICs/Timers"},
         "total_in_stock": 12,
         "parameters": [
             {"name": "Package", "value": "DIP-8"},
             {"name": "Supply Voltage", "value": "4.5 V ~ 16 V", "units": "V"},
         ],
         "stock_items": [
             {"pk": 9, "quantity": 25.0, "location": 2,
              "location_detail": {"pk": 2, "pathstring": "Workshop"}},
             {"pk": 10, "quantity": 5, "serial": "A1", "location": 3,
              "location_detail": {"pk": 3, "pathstring": "Bins"}},
         ]},
    ))
    app = ui.ScannerApp(**opts(
        lookup=lookup, inventree_url="http://inv.example",
        open_url=opened.append))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "2")
        app.post_message(ui.ScanArrived("PART-4"))
        await pilot.pause()
        assert app._current_hit is not None
        assert app._current_hit.kind == "part"
        assert app._current_hit.pk == 4
        assert app.query_one("#views").active == "view-lookup"
        body = pretty_text(app)
        assert "NE555P" in body
        assert "timer" in body
        assert "ICs/Timers" in body
        assert "DIP-8" in body
        assert "4.5 V ~ 16 V" in body
        assert "Stock (2)" in body
        assert "Workshop" in body
        assert "SN A1" in body
        assert app.query_one("#lookup-pretty").display is True
        assert app.query_one("#lookup-md").display is False
        url = "http://inv.example/web/part/4/"
        assert app.query_one("#lookup-link").url == url
        assert app.query_one("#lookup-open").disabled is False
        await pilot.press("o")
        await pilot.pause()
        assert opened == [url]


@SKIP_TUI
async def test_a_stock_item_scan_shows_quantity_and_location(ui, opts):
    lookup = _hits((
        "STK-9", "stockitem", 9,
        {"pk": 9, "quantity": 25,
         "location": 2,
         "part_detail": {
             "pk": 4, "IPN": "NE555P", "name": "NE555P",
             "description": "timer",
             "parameters": [
                 {"name": "Package", "value": "DIP-8"},
                 {"name": "Supply Voltage", "value": "4.5 V ~ 16 V",
                  "units": "V"},
             ]},
         "location_detail": {"pk": 2, "name": "Bins",
                             "pathstring": "Workshop/Bins"}},
    ))
    app = ui.ScannerApp(**opts(
        lookup=lookup, inventree_url="http://inv.example"))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "2")
        app.post_message(ui.ScanArrived("STK-9"))
        await pilot.pause()
        body = pretty_text(app)
        assert "Stock item" in body
        assert "NE555P" in body
        assert "25" in body
        assert "Workshop/Bins" in body
        assert "timer" in body
        assert "DIP-8" in body
        assert "4.5 V ~ 16 V" in body
        assert "Part" in body
        assert "Parameters" in body
        assert app.query_one("#lookup-pretty").display is True
        assert app.query_one("#lookup-link").url == (
            "http://inv.example/web/stock/item/9/")


@SKIP_TUI
async def test_a_location_scan_shows_the_path(ui, opts):
    lookup = _hits((
        "LOC-1", "stocklocation", 1,
        {"pk": 1, "name": "Workshop", "pathstring": "Workshop",
         "children": [
             {"pk": 2, "name": "Bins", "pathstring": "Workshop/Bins"},
         ],
         "stock_items": [
             {"pk": 9, "quantity": 25.0, "status_text": "OK",
              "part_detail": {"IPN": "NE555P", "name": "NE555P"},
              "serial": "A1"},
         ]},
    ))
    app = ui.ScannerApp(**opts(
        lookup=lookup, inventree_url="http://inv.example"))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "2")
        app.post_message(ui.ScanArrived("LOC-1"))
        await pilot.pause()
        assert app._current_hit.kind == "stocklocation"
        body = pretty_text(app)
        assert "Workshop" in body
        assert "Locations (1)" in body
        assert "Bins" in body
        rows = app.query("#lookup-lists Collapsible")
        assert len(rows) == 1
        row = rows.first()
        assert row.collapsed is True
        assert "25" in row.title
        assert "NE555P" in row.title
        assert "A1" in row.title
        assert app.query_one("#lookup-link").url == (
            "http://inv.example/web/stock/location/1/")


@SKIP_TUI
async def test_clicking_a_stock_item_location_opens_its_details(ui, opts):
    lookup = _hits((
        "STK-9", "stockitem", 9,
        {"pk": 9, "quantity": 25, "location": 2,
         "location_detail": {"pk": 2, "name": "Bins",
                             "pathstring": "Workshop/Bins"},
         "part_detail": {"name": "NE555P"}},
    ))
    app = ui.ScannerApp(**opts(
        lookup=lookup, inventree_url="http://inv.example"))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "2")
        app.post_message(ui.ScanArrived("STK-9"))
        await pilot.pause()
        link = app.query_one("LocationName")
        assert "Workshop/Bins" in str(link.render())
        await pilot.click(link)
        await pilot.pause()
        assert app._current_hit is not None
        assert app._current_hit.kind == "stocklocation"
        assert app._current_hit.pk == 2
        assert app.query_one("#lookup-link").url == (
            "http://inv.example/web/stock/location/2/")


@SKIP_TUI
async def test_clicking_a_part_stock_location_opens_its_details(ui, opts):
    lookup = _hits((
        "PART-4", "part", 4,
        {"pk": 4, "name": "NE555P",
         "stock_items": [
             {"pk": 9, "quantity": 25, "location": 2,
              "location_detail": {"pk": 2, "pathstring": "Workshop"}},
         ]},
    ))
    app = ui.ScannerApp(**opts(
        lookup=lookup, inventree_url="http://inv.example"))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "2")
        app.post_message(ui.ScanArrived("PART-4"))
        await pilot.pause()
        links = app.query("LocationName")
        assert len(links) == 1
        await pilot.click(links.first())
        await pilot.pause()
        assert app._current_hit.kind == "stocklocation"
        assert app._current_hit.pk == 2


@SKIP_TUI
async def test_an_unknown_barcode_says_so(ui, opts):
    app = ui.ScannerApp(**opts(lookup=lambda scan: None))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "2")
        app.post_message(ui.ScanArrived("NOPE"))
        await pilot.pause()
        assert app._current_hit is None
        assert "not in InvenTree" in str(app.query_one("#lookup-title").render())
        assert app.query_one("#lookup-open").disabled is True
        assert app.query_one("#lookup-history").row_count == 1


@SKIP_TUI
async def test_lookup_still_logs_the_scan_on_connections(ui, opts):
    lookup = _hits((
        "PART-4", "part", 4, {"pk": 4, "name": "NE555P"},
    ))
    app = ui.ScannerApp(**opts(lookup=lookup, inventree_url="http://inv.example"))
    async with app.run_test() as pilot:
        await pilot.pause()
        app.post_message(ui.ScanArrived("PART-4"))
        await pilot.pause()
        assert "PART-4" in log_text(app)
        assert app.scan_count == 1
        assert app.query_one("#views").active == "view-connections"
        assert app._current_hit is None


def capture_notify(app):
    notes = []
    original = app.notify

    def wrapped(message, **kwargs):
        notes.append(str(message))
        return original(message, **kwargs)

    app.notify = wrapped
    return notes


# --------------------------------------------------------------------------
# Scan-in
# --------------------------------------------------------------------------
@SKIP_TUI
async def test_scanin_sets_the_active_location_then_moves_stock(ui, opts):
    moved = []
    lookup = _hits(
        ("LOC-1", "stocklocation", 1,
         {"pk": 1, "name": "Bins", "pathstring": "Workshop/Bins"}),
        ("STK-9", "stockitem", 9,
         {"pk": 9, "quantity": 25,
          "part_detail": {"name": "NE555P"}}),
        ("LOC-2", "stocklocation", 2,
         {"pk": 2, "name": "Shelf", "pathstring": "Workshop/Shelf"}),
    )
    app = ui.ScannerApp(**opts(
        lookup=lookup, transfer=lambda *a, **k: moved.append((a, k)),
        inventree_url="http://inv.example"))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "3")
        app.post_message(ui.ScanArrived("LOC-1"))
        await pilot.pause()
        assert app._active_location is not None
        assert app._active_location.pk == 1
        assert "Workshop/Bins" in str(app.query_one("#scanin-title").render())
        app.post_message(ui.ScanArrived("STK-9"))
        await pilot.pause()
        assert moved == [((9, 1), {"quantity": 25, "notes": "scan-in"})]
        log = "\n".join(app.query_one("#scanin-log").lines)
        assert "NE555P" in log
        assert "Workshop/Bins" in log
        app.post_message(ui.ScanArrived("LOC-2"))
        await pilot.pause()
        assert app._active_location.pk == 2
        assert "Workshop/Shelf" in str(app.query_one("#scanin-title").render())


@SKIP_TUI
async def test_scanin_stock_without_a_location_asks_first(ui, opts):
    moved = []
    lookup = _hits((
        "STK-9", "stockitem", 9,
        {"pk": 9, "quantity": 25, "part_detail": {"name": "NE555P"}},
    ))
    app = ui.ScannerApp(**opts(
        lookup=lookup, transfer=lambda *a, **k: moved.append((a, k))))
    async with app.run_test() as pilot:
        await pilot.pause()
        notes = capture_notify(app)
        await on_tab(pilot, "3")
        app.post_message(ui.ScanArrived("STK-9"))
        await pilot.pause()
        assert moved == []
        assert any("location first" in n.lower() for n in notes)


@SKIP_TUI
async def test_scanin_ignores_parts_and_unknown_barcodes(ui, opts):
    moved = []
    lookup = _hits((
        "PART-4", "part", 4, {"pk": 4, "name": "NE555P"},
    ))
    app = ui.ScannerApp(**opts(
        lookup=lookup, transfer=lambda *a, **k: moved.append((a, k))))
    async with app.run_test() as pilot:
        await pilot.pause()
        notes = capture_notify(app)
        await on_tab(pilot, "3")
        app.post_message(ui.ScanArrived("PART-4"))
        app.post_message(ui.ScanArrived("NOPE"))
        await pilot.pause()
        assert moved == []
        assert any("not stock" in n.lower() for n in notes)
        assert any("not in inventree" in n.lower() for n in notes)


# --------------------------------------------------------------------------
# Stock creation aid
# --------------------------------------------------------------------------
@SKIP_TUI
async def test_create_adds_unknown_barcodes_and_edits_fields(ui, opts):
    saved = []
    app = ui.ScannerApp(**opts(
        lookup=lambda scan: None, export=saved.append))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "4")
        app.post_message(ui.ScanArrived("1234567890123"))
        await pilot.pause()
        assert len(app._pending) == 1
        assert app._pending[0].barcode == "1234567890123"
        assert app._pending[0].quantity == "1"
        app.query_one("#create-qty-s01").value = "25"
        app.query_one("#create-mfr-s01").value = "Yageo"
        app.query_one("#create-notes-s01").value = "from the drawer"
        await pilot.pause()
        assert app._pending[0].quantity == "25"
        assert app._pending[0].manufacturer == "Yageo"
        assert app._pending[0].notes == "from the drawer"
        await pilot.press("e")
        await pilot.pause()
        assert len(saved) == 1
        line = saved[0]["lines"][0]
        assert line["sku"] == "1234567890123"
        assert line["quantity"] == 25
        assert line["manufacturer"] == "Yageo"
        assert line["notes"] == "from the drawer"
        assert line["needs_review"] is True


@SKIP_TUI
async def test_create_duplicate_scan_increments_quantity(ui, opts):
    app = ui.ScannerApp(**opts(lookup=lambda scan: None))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "4")
        app.post_message(ui.ScanArrived("ABC"))
        await pilot.pause()
        app.post_message(ui.ScanArrived("ABC"))
        await pilot.pause()
        assert len(app._pending) == 1
        assert app._pending[0].quantity == "2"


@SKIP_TUI
async def test_create_skips_barcodes_already_in_inventree(ui, opts):
    lookup = _hits((
        "PART-4", "part", 4, {"pk": 4, "name": "NE555P"},
    ))
    app = ui.ScannerApp(**opts(lookup=lookup))
    async with app.run_test() as pilot:
        await pilot.pause()
        notes = capture_notify(app)
        await on_tab(pilot, "4")
        app.post_message(ui.ScanArrived("PART-4"))
        await pilot.pause()
        assert app._pending == []
        assert any("already a part" in n.lower() for n in notes)


@SKIP_TUI
async def test_create_remove_drops_a_pending_item(ui, opts):
    app = ui.ScannerApp(**opts(lookup=lambda scan: None))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "4")
        app.post_message(ui.ScanArrived("ABC"))
        await pilot.pause()
        app.query_one("#create-remove-s01").press()
        await pilot.pause()
        assert app._pending == []
        assert app.query_one("#create-save").disabled is True


def test_type_as_keyboard_types_then_enter(rs):
    class Fake:
        def __init__(self):
            self.calls = []

        def type(self, text):
            self.calls.append(("type", text))

        def press(self, key):
            self.calls.append(("press", key))

        def release(self, key):
            self.calls.append(("release", key))

    keyboard = Fake()
    rs.type_as_keyboard("abc", enter=True, keyboard=keyboard, enter_key="enter")
    assert keyboard.calls == [
        ("type", "abc"), ("press", "enter"), ("release", "enter")]
    keyboard.calls.clear()
    rs.type_as_keyboard("xyz", enter=False, keyboard=keyboard)
    assert keyboard.calls == [("type", "xyz")]


# --------------------------------------------------------------------------
# Keyboard wedge
# --------------------------------------------------------------------------
@SKIP_TUI
async def test_keyboard_tab_types_the_scan_and_enter(ui, opts):
    typed = []
    app = ui.ScannerApp(**opts(
        type_keys=lambda text, *, enter=True: typed.append((text, enter))))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "5")
        app.post_message(ui.ScanArrived("hello"))
        await pilot.pause()
        assert typed == [("hello", True)]
        log = "\n".join(app.query_one("#keyboard-log").lines)
        assert "hello" in log
        assert "Enter" in log


@SKIP_TUI
async def test_keyboard_tab_can_skip_enter(ui, opts):
    typed = []
    app = ui.ScannerApp(**opts(
        type_keys=lambda text, *, enter=True: typed.append((text, enter))))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "5")
        app.query_one("#keyboard-enter").value = False
        app.post_message(ui.ScanArrived("world"))
        await pilot.pause()
        assert typed == [("world", False)]
        log = "\n".join(app.query_one("#keyboard-log").lines)
        assert "world" in log
        assert "Enter" not in log


@SKIP_TUI
async def test_keyboard_tab_does_not_look_up_inventree(ui, opts):
    looked = []
    typed = []
    lookup = _hits(("PART-4", "part", 4, {"pk": 4, "name": "NE555P"}))

    def capture(scan):
        looked.append(scan)
        return lookup(scan)

    app = ui.ScannerApp(**opts(
        lookup=capture,
        type_keys=lambda text, *, enter=True: typed.append(text)))
    async with app.run_test() as pilot:
        await pilot.pause()
        await on_tab(pilot, "5")
        app.post_message(ui.ScanArrived("PART-4"))
        await pilot.pause()
        assert looked == []
        assert typed == ["PART-4"]
        assert app._current_hit is None

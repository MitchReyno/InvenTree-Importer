#!/usr/bin/env python
"""
Live scanner console: find a barcode scanner, connect to it, watch scans arrive.

    uv run scripts/register-scans.py            # TUI: scan, pick a device, connect
    uv run scripts/register-scans.py --forever  # same, and reconnect when it drops
    uv run scripts/register-scans.py --cli      # the old stdout stream
    uv run scripts/register-scans.py --list     # what there is to connect to
    uv run scripts/register-scans.py --dump --address ADDR   # its BLE services
    uv run scripts/register-scans.py --cli --source serial --port /dev/cu.usbmodem1101

The TUI is the default whenever stdout is a terminal. It scans for serial
ports and BLE advertisements, lets you pick one, and shows connection state
and incoming scans as they happen. Settings (baud, reconnect, characteristic,
auto-connect) are per remembered scanner. A second tab looks each scan up
in InvenTree (part, stock item or location) and offers a link to open it.
`--list` and `--dump` stay one-shot for scripts; `--cli` is the original
print-each-scan loop, including `--forever`.

Scanners you have connected to are remembered across sessions, in a file that
does not live in the repo:

    ~/Library/Application Support/inventree-importer/scanners.yaml   (macOS)
    ~/.config/inventree-importer/scanners.yaml                       (Linux)

INVIMPORT_SCANNER_CONFIG overrides the path. Remembered devices stay in their
own list with an online/offline/connected status, even when they are not
currently advertising.

Out of the box a scanner is a USB HID keyboard: it types into whatever window
has focus, which is no use for driving a script. The fix is not to intercept
the keyboard - it is to stop the scanner being one. Both transports below need
the scanner reconfigured first, by scanning barcodes out of its manual:

  serial  A character device, whichever way it got there. Over the cable,
          scan the transport (`USB Cable Transmit`) then `USB Cable as Virtual
          COM`, and it comes up as /dev/cu.usbmodem*. Over Bluetooth, pairing
          in SPP mode also produces a node - /dev/cu.Cbarcodescanner on the
          C750 - which is the best of both: untethered, but still five lines
          of pyserial. Worth trying before reaching for BLE, whatever the
          internet says about SPP on macOS.

  ble     Scan `Clear Pairing Information`, then `Bluetooth BLE`. The fallback
          for when SPP will not pair. There is no system pairing to do - a BLE
          peripheral is connected to from code - at the cost of a connection
          that has to be re-established every time the scanner idles off.

Mode barcodes apply only to the connection mode the scanner is currently in.
That is the usual reason this looks like it did not work.

Set a CR or CRLF suffix from the manual's Terminator page while you are in
there. Without one this still works - the pause after a scan ends it - but the
terminator is what makes the framing exact rather than inferred.

--forever is for leaving this running in the background all day. In the TUI it
just turns reconnect on. Under --cli, nothing short of Ctrl-C stops it: a
scanner that is off, out of range, asleep or not paired yet is a thing to wait
for rather than an error, so it retries with a backoff and reconnects on its
own when the scanner comes back. Without --forever the first such problem
exits, which is what you want when running it by hand.

Configuration mistakes still exit even under --forever, because retrying them
would only loop: a missing dependency, no device named, or a device that has
nothing to subscribe to.

Written against a Netum C750; anything that speaks CDC-ACM, or notifies on a
BLE characteristic, will do. Needs the optional scanner dependencies:

    uv sync --extra scanner
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import os
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

# Bytes that end a scan, if the scanner was configured to send one.
TERMINATORS = b"\r\n"

# With no terminator configured, a scan is ended by the quiet after it. Well
# above the gaps *inside* one burst - a whole payload lands in a few ms, and
# BLE splits a long one across MTU-sized notifications - and well below the gap
# between two scans made by hand.
IDLE_GAP = 0.12

# How long --forever waits between attempts. It starts short, because the
# common case is the scanner idling off for a moment, and caps low enough that
# switching it back on is noticed while you are still holding it. A link that
# was up and dropped resets to the short delay, so a blip costs one second.
FIRST_RETRY = 1.0
MAX_RETRY = 8.0

# Serial devices worth trying, matched case-insensitively against the device
# name. macOS exposes each one twice: /dev/tty.* blocks until carrier detect,
# /dev/cu.* does not, so cu is the one to open. The first four are USB bridges;
# the rest are what a Bluetooth SPP pairing names itself after the scanner, as
# in /dev/cu.Cbarcodescanner.
PORT_HINTS = ("usbmodem", "usbserial", "slab", "wchusb",
              "barcode", "scanner", "netum")

# The characteristics that carry scans on scanners that document them. Netum
# publishes no GATT UUIDs, so discovery falls back to whichever one notifies.
KNOWN_NOTIFY = (
    "6e400003-b5a3-f393-e0a9-e50e24dcca9e",  # Nordic UART, TX to host
    "0000ffe1-0000-1000-8000-00805f9b34fb",  # the common vendor UART
)

SERIAL_HINT = (
    "Plug it in and check it is in Virtual COM mode - in HID keyboard mode it\n"
    "enumerates as a keyboard and no port appears at all. `--list` shows what\n"
    "is there, and --forever waits for it instead of giving up.")

BLE_HINT = (
    "The scanner powers its radio down when idle - pull the trigger once to\n"
    "wake it - and check it is in BLE mode, not HID or SPP. `--list` shows\n"
    "what is advertising, --address takes one from it, and --forever waits.")


class Unavailable(RuntimeError):
    """The scanner is not there, or has stopped being there.

    Expected rather than exceptional: under --forever it means wait, and
    `connected` says whether we had a working link before it went, which is
    the difference between "not switched on yet" and "dropped out".
    """

    def __init__(self, message: str, connected: bool = False) -> None:
        super().__init__(message)
        self.connected = connected


class ConfigError(RuntimeError):
    """A setting is wrong. Retrying will not help."""


def require(module: str):
    """Import a scanner dependency, or say how to get it."""
    try:
        return importlib.import_module(module)
    except ImportError:
        raise SystemExit(
            f"{module} is not installed - it is an optional dependency.\n"
            f"    uv sync --extra scanner")


def reason(exc: BaseException) -> str:
    """Something printable. Some bleak errors stringify to nothing at all."""
    return str(exc).strip() or exc.__class__.__name__


# --------------------------------------------------------------------------
# Framing
# --------------------------------------------------------------------------
class ScanBuffer:
    """Bytes in, whole scans out.

    Both transports deliver a scan in however many pieces they feel like, so
    neither can treat one read as one scan. A terminator ends a scan; failing
    that, `idle()` ends whatever is still buffered once the data stops.
    """

    def __init__(self, gap: float = IDLE_GAP) -> None:
        self._buf = bytearray()
        self._gap = gap
        self._last = 0.0

    def feed(self, data: bytes) -> list[str]:
        """Take bytes off the wire. Returns the scans they completed."""
        self._buf.extend(data)
        self._last = time.monotonic()
        scans: list[str] = []
        while True:
            end = next((n for n, b in enumerate(self._buf)
                        if b in TERMINATORS), None)
            if end is None:
                break
            payload = bytes(self._buf[:end])
            del self._buf[:end + 1]
            # CRLF leaves an empty payload behind on the second pass.
            if payload:
                scans.append(payload.decode("utf-8", "replace"))
        return scans

    def idle(self) -> list[str]:
        """Whatever is still held once the data has stopped arriving."""
        if not self._buf or time.monotonic() - self._last < self._gap:
            return []
        payload = bytes(self._buf)
        self._buf.clear()
        return [payload.decode("utf-8", "replace")]


# --------------------------------------------------------------------------
# Display
# --------------------------------------------------------------------------
def printable(scan: str) -> str:
    """Control characters shown rather than executed.

    A DigiKey 2D barcode is full of them - GS between fields, RS around the
    header - and printing them raw walks the cursor around the terminal.
    """
    return "".join(c if c.isprintable() else f"\\x{ord(c):02x}" for c in scan)


def printer() -> Callable[[str], None]:
    """Print each scan, numbered, as it lands."""
    seen = 0

    def show(scan: str) -> None:
        nonlocal seen
        seen += 1
        stamp = datetime.now().strftime("%H:%M:%S")
        print(f"{stamp}  {seen:>4}  {printable(scan)}", flush=True)

    return show


def reporter() -> Callable[[str], None]:
    """Say what the link is doing, but only when it changes.

    Under --forever the same attempt can fail identically for hours. Printing
    every one buries the scans in noise; printing none leaves you unable to
    tell a waiting script from a wedged one. So: transitions only.
    """
    last: str | None = None

    def state(message: str) -> None:
        nonlocal last
        if message == last:
            return
        last = message
        stamp = datetime.now().strftime("%H:%M:%S")
        print(f"{stamp}  -- {message}", flush=True)

    return state


# --------------------------------------------------------------------------
# Supervision
# --------------------------------------------------------------------------
def supervise(attempt: Callable[[], None], forever: bool,
              state: Callable[[str], None], hint: str) -> int:
    """Run one session. Under --forever, keep running it.

    A session only ever ends by going wrong - there is no such thing as
    finishing normally - so every exit from `attempt` is something to report
    or something to wait out.
    """
    delay = FIRST_RETRY
    while True:
        try:
            attempt()
            trouble, was_connected = "session ended", True
        except ConfigError as exc:
            print(exc, file=sys.stderr)
            print(hint, file=sys.stderr)
            return 1
        except Unavailable as exc:
            trouble, was_connected = reason(exc), exc.connected
        except Exception as exc:
            # Anything the transports did not anticipate. Under --forever an
            # unknown fault is still no reason to stop listening.
            trouble, was_connected = f"error: {reason(exc)}", False

        if not forever:
            print(trouble, file=sys.stderr)
            print(hint, file=sys.stderr)
            return 1

        # A link that was up a moment ago deserves a quick retry, not the
        # backoff earned by something that has never answered.
        if was_connected:
            delay = FIRST_RETRY
        state(f"{trouble} - retrying")
        time.sleep(delay)
        delay = min(delay * 2, MAX_RETRY)


# --------------------------------------------------------------------------
# Serial
# --------------------------------------------------------------------------
def serial_ports() -> list:
    """The ports that look like a scanner in Virtual COM mode."""
    try:
        list_ports = importlib.import_module("serial.tools.list_ports")
    except ImportError:
        return []
    return [p for p in list_ports.comports()
            if "/cu." in p.device
            and any(h in p.device.lower() for h in PORT_HINTS)]


def serial_session(port: str | None, baud: int,
                   on_scan: Callable[[str], None],
                   state: Callable[[str], None],
                   stop: threading.Event | None = None,
                   on_open: Callable | None = None) -> None:
    """Read scans until the port goes away. Never returns normally."""
    serial = require("serial")
    target = port
    if target is None:
        found = serial_ports()
        if not found:
            raise Unavailable("no serial port that looks like a scanner")
        target = found[0].device
        if len(found) > 1:
            state(f"{len(found)} candidate ports, using {target} "
                  f"(--port to choose)")

    connected = False
    try:
        with serial.Serial(target, baud, timeout=0.05) as link:
            # Whatever is already sitting in the buffer was sent before
            # anything was listening - scans made while disconnected, or the
            # fragment a Bluetooth link drops on the floor while it comes up.
            # It is never a scan we can trust the front of.
            link.reset_input_buffer()
            if on_open is not None:
                on_open(link)
            connected = True
            state(f"listening on {target} at {baud} baud")
            # Outside the loop: a scan split across two reads is reassembled
            # here, so a fresh buffer per read would tear every one of them.
            buf = ScanBuffer()
            while stop is None or not stop.is_set():
                data = link.read(link.in_waiting or 1)
                for scan in (buf.feed(data) if data else buf.idle()):
                    on_scan(scan)
            return
    except OSError as exc:
        # SerialException is an OSError, as is the port vanishing mid-read
        # when the Bluetooth link drops. Closing the port from the TUI to
        # cancel a session looks the same, and is handled by the caller.
        raise Unavailable(f"{target}: {reason(exc)}", connected) from exc


# --------------------------------------------------------------------------
# BLE
# --------------------------------------------------------------------------
def pick_notify(client, chosen: str | None) -> str:
    """The characteristic scans arrive on."""
    if chosen:
        return chosen
    notifying = [c for s in client.services for c in s.characteristics
                 if "notify" in c.properties or "indicate" in c.properties]
    if not notifying:
        raise ConfigError(
            "Connected, but nothing on this device notifies. It is probably\n"
            "still in HID or SPP mode - scan the Bluetooth BLE barcode.")
    for uuid in KNOWN_NOTIFY:
        for char in notifying:
            if char.uuid.lower() == uuid:
                return char.uuid
    if len(notifying) == 1:
        return notifying[0].uuid
    listing = "\n".join(f"    {c.uuid}  {','.join(c.properties)}"
                        for c in notifying)
    raise ConfigError(
        f"Several characteristics notify - pick one with --characteristic "
        f"or in Settings:\n"
        f"{listing}\n"
        f"Scan a barcode with each subscribed in turn; the right one is the\n"
        f"one that produces the payload.")


def require_target(name: str | None, address: str | None) -> None:
    """Refuse to go looking for nothing in particular."""
    if address or name:
        return
    raise SystemExit(
        "Which device? There is no sensible default - the C750 does not\n"
        "advertise its make, and over SPP it calls itself something like\n"
        "'Cbarcodescanner'. Run --list and pass --address, or --name if\n"
        "the advertised name is distinctive enough.")


async def find_device(bleak, name: str | None, address: str | None,
                      timeout: float):
    """The scanner, by address if we were given one, else by name."""
    require_target(name, address)
    if address:
        return await bleak.BleakScanner.find_device_by_address(
            address, timeout=timeout)
    return await bleak.BleakScanner.find_device_by_filter(
        lambda d, _: bool(d.name) and name.lower() in d.name.lower(),
        timeout=timeout)


async def ble_session(name: str | None, address: str | None,
                      chosen: str | None, timeout: float,
                      on_scan: Callable[[str], None],
                      state: Callable[[str], None],
                      known=None,
                      stop: asyncio.Event | None = None,
                      on_open: Callable | None = None) -> None:
    """Subscribe and read scans until the link drops. Never returns."""
    bleak = require("bleak")
    if known is not None:
        device = known
    else:
        require_target(name, address)
        state(f"looking for {address or name!r}")
        device = await find_device(bleak, name, address, timeout)
        if device is None:
            raise Unavailable(f"no BLE device matching {address or name!r}")

    buf = ScanBuffer()
    connected = False
    try:
        async with bleak.BleakClient(device) as client:
            char = pick_notify(client, chosen)
            if on_open is not None:
                on_open(client)

            def arrived(_, data: bytearray) -> None:
                for scan in buf.feed(bytes(data)):
                    on_scan(scan)

            await client.start_notify(char, arrived)
            connected = True
            state(f"connected to {device.name or device.address} on {char}")
            while client.is_connected:
                if stop is not None and stop.is_set():
                    return
                # Also the tick that closes off a scan with no terminator.
                await asyncio.sleep(IDLE_GAP)
                for scan in buf.idle():
                    on_scan(scan)
    except ConfigError:
        raise
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        raise Unavailable(reason(exc), connected) from exc
    raise Unavailable("scanner disconnected", connected=True)


# --------------------------------------------------------------------------
# Listing
# --------------------------------------------------------------------------
def short_uuid(uuid: str) -> str:
    """0000ffe0-0000-1000-8000-00805f9b34fb is really just ffe0."""
    if uuid.lower().endswith("-0000-1000-8000-00805f9b34fb"):
        return uuid[4:8]
    return uuid


def format_gatt(client) -> str:
    """Every service and characteristic, for working out which one carries
    scans. Netum publishes no GATT documentation, so this is the way in."""
    lines: list[str] = []
    for service in client.services:
        lines.append(f"service {service.uuid}  {service.description}")
        for char in service.characteristics:
            props = ",".join(char.properties)
            lines.append(f"  {char.uuid}  {props:<34} {char.description}")
    return "\n".join(lines) or "no services"


async def dump_gatt(name: str | None, address: str | None,
                    timeout: float) -> int:
    require_target(name, address)
    bleak = require("bleak")
    print(f"Looking for {address or name!r}...", flush=True)
    device = await find_device(bleak, name, address, timeout)
    if device is None:
        print(f"No BLE device matching {address or name!r} within "
              f"{timeout:g}s.\n{BLE_HINT}", file=sys.stderr)
        return 1
    async with bleak.BleakClient(device) as client:
        print(f"\n{device.name or '(no name)'} ({device.address})\n")
        print(format_gatt(client))
    return 0


async def list_sources(name: str | None, timeout: float) -> int:
    require("serial")
    ports = serial_ports()
    print("Serial ports:")
    for port in ports:
        print(f"  {port.device:<28} {port.description}")
    if not ports:
        print("  none that look like a scanner")

    bleak = require("bleak")
    print(f"\nBLE devices ({timeout:g}s)...", flush=True)
    # Everything, named or not: a scanner that advertises no name is exactly
    # the one you cannot find any other way. Strongest signal first, because
    # the device in your hand is the closest thing in the room.
    found = await bleak.BleakScanner.discover(timeout=timeout, return_adv=True)
    rows = sorted(found.values(), key=lambda pair: pair[1].rssi or -999,
                  reverse=True)
    for device, advert in rows:
        label = device.name or "(no name)"
        services = " ".join(short_uuid(u) for u in advert.service_uuids)
        mark = ""
        if name and device.name and name.lower() in device.name.lower():
            mark = "  <-- matches --name"
        print(f"  {advert.rssi:>4} dBm  {device.address}  {label:<28}"
              f"{services}{mark}")
    if not rows:
        print("  nothing advertising")
    else:
        print("\nClosest first. Pick one with --address, then --dump it.")
    return 0


# --------------------------------------------------------------------------
# Live interface
# --------------------------------------------------------------------------
@dataclass
class Found:
    """A serial port or a BLE advertisement the table can show."""

    kind: str
    key: str
    label: str
    detail: str
    rssi: int | None = None
    port: str | None = None
    address: str | None = None
    ble_device: object | None = None
    last_seen: float = field(default_factory=time.monotonic)

    def matches(self, needle: str) -> bool:
        if not needle:
            return True
        hay = f"{self.kind} {self.label} {self.detail} {self.key}".lower()
        return needle.lower() in hay


# Where remembered scanners live. Not the repo: this is machine-local state,
# and a git checkout should not grow a file every time you pair a reader.
CONFIG_ENV = "INVIMPORT_SCANNER_CONFIG"


def default_config_path() -> Path:
    override = os.environ.get(CONFIG_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support" / "inventree-importer"
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME", "").strip()
        root = Path(xdg).expanduser() if xdg else Path.home() / ".config"
        root = root / "inventree-importer"
    return root / "scanners.yaml"


@dataclass
class SavedScanner:
    """A scanner that has been connected to before."""

    key: str
    kind: str
    label: str
    port: str | None = None
    address: str | None = None
    auto_connect: bool = False
    reconnect: bool = True
    baud: int = 9600
    characteristic: str | None = None
    last_connected: str | None = None

    def as_found(self) -> Found:
        return Found(
            kind=self.kind, key=self.key, label=self.label,
            detail=self.address or self.port or "",
            port=self.port, address=self.address,
        )


class ScannerStore:
    """YAML file of remembered scanners. Load once, save on every change."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = Path(path) if path is not None else default_config_path()
        self.scanners: dict[str, SavedScanner] = {}

    def load(self) -> None:
        import yaml
        self.scanners = {}
        if not self.path.is_file():
            return
        try:
            raw = yaml.safe_load(self.path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            return
        for row in raw.get("scanners") or []:
            if not isinstance(row, dict) or not row.get("key"):
                continue
            char = row.get("characteristic") or None
            baud = row.get("baud") or 9600
            try:
                baud = int(baud)
            except (TypeError, ValueError):
                baud = 9600
            saved = SavedScanner(
                key=str(row["key"]),
                kind=str(row.get("kind") or "ble"),
                label=str(row.get("label") or row["key"]),
                port=row.get("port") or None,
                address=row.get("address") or None,
                auto_connect=bool(row.get("auto_connect")),
                reconnect=bool(row.get("reconnect", True)),
                baud=baud if baud > 0 else 9600,
                characteristic=str(char) if char else None,
                last_connected=row.get("last_connected") or None,
            )
            self.scanners[saved.key] = saved

    def save(self) -> None:
        import yaml
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "scanners": [asdict(s) for s in self.scanners.values()],
        }
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(
            yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
            encoding="utf-8")
        tmp.replace(self.path)

    def get(self, key: str | None) -> SavedScanner | None:
        if not key:
            return None
        return self.scanners.get(key)

    def put(self, saved: SavedScanner) -> SavedScanner:
        self.scanners[saved.key] = saved
        self.save()
        return saved

    def forget(self, key: str) -> None:
        if self.scanners.pop(key, None) is not None:
            self.save()


_TUI = None


def tui():
    """Load Textual and the app class once.

    Kept lazy so --list/--dump/--cli still run if someone has pyserial and
    bleak but not the TUI extra. Tests import this to get ScannerApp without
    opening a terminal or touching the radio.
    """
    global _TUI
    if _TUI is not None:
        return _TUI
    require("textual")
    from rich.text import Text
    from textual import work
    from textual.app import App, ComposeResult
    from textual.binding import Binding
    from textual.containers import Horizontal, ScrollableContainer, Vertical
    from textual.message import Message
    from textual.reactive import reactive
    from textual.screen import ModalScreen
    from textual.widgets import (Button, Collapsible, DataTable, Footer, Header,
                                 Input, Label, Link, Log, Markdown, Static,
                                 Switch, TabbedContent, TabPane)
    from textual.worker import Worker, WorkerState, get_current_worker

    from invimport.inventree.stock import (
        BarcodeHit, DetailSection, child_location_ref, enrich_hit,
        format_count, location_hit, location_ref, lookup_barcode,
        render_hit, render_section, stock_expand_fields, stock_line, web_url)

    LOOKUP_IDLE = (
        "Scan a **location**, **stock item** or **part** barcode.\n\n"
        "The match and a link to its InvenTree page will land here.")
    LOOKUP_MISSING = (
        "InvenTree is not configured. Set `INVENTREE_URL` and "
        "`INVENTREE_TOKEN` (or user and password) in the `.env` or the "
        "environment, then restart.")

    class ScanArrived(Message):
        def __init__(self, scan: str) -> None:
            super().__init__()
            self.scan = scan

    class LinkState(Message):
        def __init__(self, text: str, phase: str) -> None:
            super().__init__()
            self.text = text
            self.phase = phase

    class SerialSnapshot(Message):
        def __init__(self, ports: list) -> None:
            super().__init__()
            self.ports = ports

    class BleSeen(Message):
        def __init__(self, device, advert) -> None:
            super().__init__()
            self.device = device
            self.advert = advert

    class GattReady(Message):
        def __init__(self, title: str, body: str) -> None:
            super().__init__()
            self.title = title
            self.body = body

    class LogNote(Message):
        def __init__(self, text: str) -> None:
            super().__init__()
            self.text = text

    class LookupReady(Message):
        def __init__(self, scan: str, hit: BarcodeHit | None) -> None:
            super().__init__()
            self.scan = scan
            self.hit = hit

    class LookupFailed(Message):
        def __init__(self, scan: str, error: str) -> None:
            super().__init__()
            self.scan = scan
            self.error = error

    class GattScreen(ModalScreen):
        BINDINGS = [Binding("escape,q,g", "dismiss", "Close")]
        CSS = """
        GattScreen { align: center middle; }
        #gatt {
            width: 90%;
            height: 80%;
            background: $surface;
            border: thick $accent;
            padding: 1 1 0 1;
        }
        #gatt-title { height: 1; text-style: bold; padding: 0 1; }
        #gatt-body { height: 1fr; }
        """

        def __init__(self, title: str, body: str) -> None:
            super().__init__()
            self._title = title
            self._body = body

        def compose(self) -> ComposeResult:
            with Vertical(id="gatt"):
                yield Label(self._title, id="gatt-title")
                yield Log(id="gatt-body")
                yield Footer()

        def on_mount(self) -> None:
            self.query_one("#gatt-body", Log).write(self._body)

    class LocationName(Static, can_focus=True):
        """A location path that opens that location in Lookup."""

        DEFAULT_CSS = """
        LocationName {
            width: auto;
            height: 1;
            color: $text-accent;
            text-style: underline;
            padding: 0 1 0 0;
            &:hover { color: $accent; }
            &:focus { text-style: bold reverse; }
            pointer: pointer;
        }
        """

        def __init__(self, label: str, pk: int,
                     payload: dict | None = None, **kwargs) -> None:
            super().__init__(label, **kwargs)
            self.location_pk = pk
            self.location_payload = payload or {"pk": pk}

        def on_click(self) -> None:
            self.app.navigate_location(self.location_pk, self.location_payload)

        def action_open_location(self) -> None:
            self.app.navigate_location(self.location_pk, self.location_payload)

        BINDINGS = [Binding("enter", "open_location", "Open location",
                            show=False)]

    class ScannerApp(App):
        TITLE = "register-scans"
        AUTO_FOCUS = "#nearby"
        ENABLE_COMMAND_PALETTE = False

        BINDINGS = [
            Binding("1", "show_connections", "Connections"),
            Binding("2", "show_lookup", "Lookup"),
            Binding("s", "scan", "Scan"),
            Binding("c", "connect", "Connect"),
            Binding("d", "disconnect", "Disconnect"),
            Binding("a", "toggle_auto", "Auto"),
            Binding("f", "forget", "Forget"),
            Binding("g", "gatt", "GATT"),
            Binding("x", "clear_scans", "Clear"),
            Binding("o", "open_item", "Open"),
            Binding("r", "toggle_reconnect", "Reconnect"),
            Binding("u", "toggle_unnamed", "Unnamed"),
            Binding("q", "quit", "Quit"),
        ]

        CSS = """
        #status {
            height: 1;
            padding: 0 1;
            background: $boost;
            text-style: bold;
        }
        #status.scanning, #status.connecting, #status.retrying {
            background: $warning-darken-2;
            color: $text;
        }
        #status.connected {
            background: $success-darken-2;
            color: $text;
        }
        #status.error {
            background: $error-darken-2;
            color: $text;
        }

        #views { height: 1fr; }
        #connections { height: 1fr; }
        #body { height: 1fr; }

        #lookup-body { height: 1fr; }
        #lookup-detail {
            width: 3fr;
            padding: 0 1 1 1;
        }
        #lookup-history-panel {
            width: 2fr;
            height: 1fr;
            border: round $primary;
        }
        #lookup-history-panel:focus-within { border: round $accent; }
        #lookup-title {
            height: auto;
            text-style: bold;
            padding: 1 0 1 0;
        }
        #lookup-scroll { height: 1fr; }
        #lookup-md { height: auto; }
        #lookup-pretty { height: auto; padding: 0 0 1 0; }
        #lookup-lists { height: auto; padding: 0 0 1 0; }
        #lookup-lists .panel-header { margin: 1 0 0 0; }
        #lookup-lists Collapsible {
            padding: 0 1;
            margin: 0 0 0 0;
        }
        .jump-row, .stock-jump-row {
            height: 1;
            padding: 0 1;
            align: left middle;
        }
        .jump-label {
            width: 16;
            height: 1;
            color: $text-accent;
            text-style: bold;
        }
        .stock-qty {
            width: 8;
            height: 1;
            content-align: right middle;
            padding: 0 1 0 0;
        }
        .stock-extra { height: 1; color: $text-muted; }
        #lookup-actions {
            height: auto;
            padding: 0 0 1 0;
            align: left middle;
        }
        #lookup-link { width: 1fr; height: 1; }
        #lookup-open { width: auto; min-width: 20; }
        #lookup-history { height: 1fr; }

        #devices-panel, #scans-panel {
            height: 1fr;
            border: round $primary;
        }
        #devices-panel { width: 1fr; min-width: 42; layout: vertical; }
        #scans-panel { width: 3fr; }
        #devices-panel:focus-within, #scans-panel:focus-within {
            border: round $accent;
        }

        #remembered-panel, #nearby-panel {
            border: round $panel;
        }
        #remembered-panel { height: 1fr; }
        #nearby-panel { height: 2fr; }
        #remembered-panel:focus-within, #nearby-panel:focus-within {
            border: round $accent;
        }

        #devices-header, #scans-header, .panel-header {
            height: 1;
            padding: 0 1;
            background: $boost;
        }
        #devices-header { layout: horizontal; }
        #filter {
            width: 1fr;
            height: 1;
            border: none;
            padding: 0 1;
            background: $surface;
        }
        #remembered, #nearby { height: 1fr; }
        #scans { height: 1fr; }

        #settings {
            height: 3;
            padding: 0 1;
            background: $panel;
            align: left middle;
        }
        #settings Label {
            width: auto;
            height: 1;
            padding: 0 1 0 2;
            content-align: left middle;
        }
        #settings Input {
            width: 10;
            height: 1;
            border: none;
            padding: 0 1;
            background: $boost;
        }
        #settings #characteristic { width: 28; }
        #settings Switch {
            background: transparent;
            border: none;
            padding: 0;
        }
        """

        phase: str = reactive("idle")
        status_text: str = reactive("starting")

        def __init__(self, **opts) -> None:
            super().__init__()
            # Tests pass live=False so mount does not open a BLE scanner or
            # poll serial ports. The rest of the UI is identical.
            self.live = opts.pop("live", True)
            config_path = opts.pop("config_path", None)
            self._lookup_fn = opts.pop("lookup", None)
            self._open_url = opts.pop("open_url", None)
            self._inventree_url = opts.pop("inventree_url", None)
            self._opts = opts
            self.store = ScannerStore(config_path)
            self.store.load()
            self.devices: dict[str, Found] = {}
            self._nearby_rows: set[str] = set()
            self._remembered_rows: set[str] = set()
            self.connected_key: str | None = None
            self.scan_count = 0
            self._want_session = False
            self._scanning = False
            self._auto_done = False
            self._loading_settings = False
            self._settings_key: str | None = None
            self._thread_stop = threading.Event()
            self._async_stop: asyncio.Event | None = None
            self._serial_link = None
            self._ble_client = None
            self._inventree_api = None
            self._inventree_error: str | None = None
            self._current_hit: BarcodeHit | None = None
            self._lookup_seq = 0
            self._hits_by_row: dict[str, tuple[str, BarcodeHit | None]] = {}

        def compose(self) -> ComposeResult:
            yield Header(show_clock=True)
            with TabbedContent(id="views"):
                with TabPane("Connections", id="view-connections"):
                    with Vertical(id="connections"):
                        with Horizontal(id="body"):
                            with Vertical(id="devices-panel"):
                                with Vertical(id="remembered-panel"):
                                    yield Label("Remembered",
                                                classes="panel-header")
                                    yield DataTable(
                                        id="remembered", cursor_type="row",
                                        zebra_stripes=True)
                                with Vertical(id="nearby-panel"):
                                    with Horizontal(id="devices-header"):
                                        yield Label("Nearby")
                                        yield Input(placeholder="filter",
                                                    id="filter")
                                    yield DataTable(
                                        id="nearby", cursor_type="row",
                                        zebra_stripes=True)
                            with Vertical(id="scans-panel"):
                                yield Label("Scans", id="scans-header")
                                yield Log(id="scans", highlight=True,
                                          max_lines=2000)
                        with Horizontal(id="settings"):
                            yield Label("Auto")
                            yield Switch(
                                value=False, id="auto",
                                tooltip="Connect this scanner when it appears")
                            yield Label("Reconnect")
                            yield Switch(
                                value=self._opts["reconnect"], id="reconnect",
                                tooltip="Retry when this scanner drops")
                            yield Label("Baud")
                            yield Input(str(self._opts["baud"]), id="baud",
                                        type="integer", tooltip="Serial speed")
                            yield Label("Characteristic")
                            yield Input(
                                self._opts["characteristic"] or "",
                                id="characteristic",
                                placeholder="auto",
                                tooltip="BLE notify UUID; blank picks a known one",
                            )
                            yield Label("Unnamed")
                            yield Switch(
                                value=False, id="unnamed",
                                tooltip="Show BLE devices that advertise no name")
                with TabPane("Lookup", id="view-lookup"):
                    with Horizontal(id="lookup-body"):
                        with Vertical(id="lookup-detail"):
                            yield Label(
                                "Scan a location, stock item or part",
                                id="lookup-title")
                            with ScrollableContainer(id="lookup-scroll"):
                                yield Markdown(LOOKUP_IDLE, id="lookup-md")
                                yield Static(id="lookup-pretty")
                                yield Vertical(id="lookup-lists")
                            with Horizontal(id="lookup-actions"):
                                yield Link("Open in InvenTree", url="",
                                           id="lookup-link")
                                yield Button("Open in InvenTree",
                                             id="lookup-open", disabled=True)
                        with Vertical(id="lookup-history-panel"):
                            yield Label("History", classes="panel-header")
                            yield DataTable(id="lookup-history",
                                            cursor_type="row",
                                            zebra_stripes=True)
            yield Static("starting", id="status")
            yield Footer(show_command_palette=False)

        def on_mount(self) -> None:
            remembered = self.query_one("#remembered", DataTable)
            remembered.add_column("Status", key="status", width=10)
            remembered.add_column("Kind", key="kind", width=8)
            remembered.add_column("Device", key="device")
            remembered.add_column("Auto", key="auto", width=4)
            remembered.add_column("Signal", key="signal", width=8)
            nearby = self.query_one("#nearby", DataTable)
            nearby.add_column("Kind", key="kind", width=8)
            nearby.add_column("Signal", key="signal", width=8)
            nearby.add_column("Device", key="device")
            nearby.add_column("Detail", key="detail")
            history = self.query_one("#lookup-history", DataTable)
            history.add_column("When", key="when", width=8)
            history.add_column("Type", key="type", width=12)
            history.add_column("Scan", key="scan")
            history.add_column("Item", key="item")
            self.query_one("#lookup-link", Link).display = False
            self.query_one("#lookup-pretty", Static).display = False
            if self.live and self._lookup_fn is None:
                self.connect_inventree()
            if self._opts["port"]:
                self.upsert(Found(
                    kind="serial",
                    key=f"serial:{self._opts['port']}",
                    label=self._opts["port"],
                    detail="from --port",
                    port=self._opts["port"],
                ))
            if self._opts["address"]:
                self.upsert(Found(
                    kind="ble",
                    key=f"ble:{self._opts['address']}",
                    label=self._opts["name"] or self._opts["address"],
                    detail="from --address",
                    address=self._opts["address"],
                ))
            self.rebuild_remembered()
            self.set_phase("scanning", "scanning for devices · pull the "
                           "trigger to wake a BLE scanner")
            if self.live:
                self.watch_serial()
                self.start_ble_scan()
            self.maybe_auto_connect_online()

        def watch_phase(self, phase: str) -> None:
            self.query_one("#status", Static).set_classes(phase)

        def watch_status_text(self, text: str) -> None:
            self.refresh_status()

        def set_phase(self, phase: str, text: str) -> None:
            self.phase = phase
            self.status_text = text

        def refresh_status(self) -> None:
            extra = f" · {self.scan_count} scan" + (
                "s" if self.scan_count != 1 else "")
            shown = self.status_text + (
                extra if self.phase == "connected" else "")
            self.query_one("#status", Static).update(shown)

        def baud_from_widget(self) -> int:
            raw = self.query_one("#baud", Input).value.strip()
            try:
                value = int(raw)
            except ValueError:
                return 9600
            return value if value > 0 else 9600

        def characteristic_from_widget(self) -> str | None:
            raw = self.query_one("#characteristic", Input).value.strip()
            return raw or None

        def session_baud(self, device: Found) -> int:
            saved = self.store.get(device.key)
            return saved.baud if saved else self.baud_from_widget()

        def session_characteristic(self, device: Found) -> str | None:
            saved = self.store.get(device.key)
            if saved:
                return saved.characteristic
            return self.characteristic_from_widget()

        def session_reconnect(self, device: Found) -> bool:
            saved = self.store.get(device.key)
            if saved:
                return saved.reconnect
            return self.query_one("#reconnect", Switch).value

        def show_unnamed(self) -> bool:
            return self.query_one("#unnamed", Switch).value

        def filter_text(self) -> str:
            return self.query_one("#filter", Input).value.strip()

        def nearby_visible(self, device: Found) -> bool:
            if device.key in self.store.scanners:
                return False
            if self.connected_key == device.key:
                return True
            if not device.matches(self.filter_text()):
                return False
            if (device.kind == "ble" and not self.show_unnamed()
                    and device.label == "(no name)"):
                return False
            return True

        def remembered_visible(self, saved: SavedScanner) -> bool:
            if self.connected_key == saved.key:
                return True
            return saved.as_found().matches(self.filter_text())

        def device_status(self, key: str) -> str:
            if key == self.connected_key:
                if self.phase == "retrying":
                    return "retrying"
                if self.phase == "connecting":
                    return "connecting"
                return "connected"
            if key in self.devices:
                return "online"
            return "offline"

        def upsert(self, device: Found) -> None:
            self.devices[device.key] = device
            if device.key in self.store.scanners:
                saved = self.store.scanners[device.key]
                if device.label and device.label != "(no name)":
                    saved.label = device.label
                self.rebuild_remembered()
                self.maybe_auto_connect(device)
                return
            if not self.nearby_visible(device):
                self.drop_nearby_row(device.key)
            elif device.key in self._nearby_rows:
                self.update_nearby_row(device)
            else:
                self.rebuild_nearby()
            if not self._auto_done and self.matches_auto(device):
                self._auto_done = True
                self.start_session(device)

        def drop_device(self, key: str) -> None:
            self.devices.pop(key, None)
            self.drop_nearby_row(key)
            if key in self.store.scanners:
                self.rebuild_remembered()

        def drop_nearby_row(self, key: str) -> None:
            if key not in self._nearby_rows:
                return
            table = self.query_one("#nearby", DataTable)
            try:
                table.remove_row(key)
            except KeyError:
                pass
            self._nearby_rows.discard(key)

        def nearby_cells(self, device: Found) -> tuple:
            mark = "● " if device.key == self.connected_key else ""
            kind = Text(f"{mark}{device.kind}")
            if device.key == self.connected_key:
                kind.stylize("bold green")
            return kind, self.signal_cell(device.rssi), device.label, device.detail

        def remembered_cells(self, saved: SavedScanner) -> tuple:
            status_name = self.device_status(saved.key)
            tone = {
                "connected": "bold green",
                "connecting": "yellow",
                "retrying": "yellow",
                "online": "green",
                "offline": "dim",
            }.get(status_name, "")
            status = Text(status_name, style=tone)
            observed = self.devices.get(saved.key)
            rssi = observed.rssi if observed else None
            auto = "on" if saved.auto_connect else "—"
            return status, saved.kind, saved.label, auto, self.signal_cell(rssi)

        def signal_cell(self, rssi: int | None):
            if rssi is None:
                return Text("—", justify="right", style="dim")
            tone = ("green" if rssi >= -60
                    else "yellow" if rssi >= -80 else "dim")
            return Text(f"{rssi}", justify="right", style=tone)

        def update_nearby_row(self, device: Found) -> None:
            table = self.query_one("#nearby", DataTable)
            kind, signal, label, detail = self.nearby_cells(device)
            table.update_cell(device.key, "kind", kind)
            table.update_cell(device.key, "signal", signal)
            table.update_cell(device.key, "device", label)
            table.update_cell(device.key, "detail", detail)

        def rebuild_nearby(self) -> None:
            table = self.query_one("#nearby", DataTable)
            selected = self._cursor_key(table)
            table.clear()
            self._nearby_rows.clear()
            rows = sorted(
                (d for d in self.devices.values() if self.nearby_visible(d)),
                key=lambda d: (
                    0 if d.kind == "serial" else 1,
                    -(d.rssi if d.rssi is not None else -999),
                    d.label.lower(),
                ),
            )
            cursor = 0
            for device in rows:
                table.add_row(*self.nearby_cells(device), key=device.key)
                self._nearby_rows.add(device.key)
                if device.key == selected:
                    cursor = table.row_count - 1
            if table.row_count:
                table.move_cursor(row=cursor)

        def rebuild_remembered(self) -> None:
            table = self.query_one("#remembered", DataTable)
            selected = self._cursor_key(table)
            table.clear()
            self._remembered_rows.clear()
            rows = [s for s in self.store.scanners.values()
                    if self.remembered_visible(s)]
            rows.sort(key=lambda s: (
                0 if s.key == self.connected_key else 1,
                0 if self.device_status(s.key) != "offline" else 1,
                s.label.lower(),
            ))
            cursor = 0
            for saved in rows:
                table.add_row(*self.remembered_cells(saved), key=saved.key)
                self._remembered_rows.add(saved.key)
                if saved.key == selected:
                    cursor = table.row_count - 1
            if table.row_count:
                table.move_cursor(row=cursor)

        def rebuild_table(self) -> None:
            self.rebuild_nearby()
            self.rebuild_remembered()

        def _cursor_key(self, table) -> str | None:
            if not table.row_count:
                return None
            row_key, _ = table.coordinate_to_cell_key(table.cursor_coordinate)
            return row_key.value

        def selected_table(self):
            remembered = self.query_one("#remembered", DataTable)
            if remembered.has_focus:
                return remembered
            return self.query_one("#nearby", DataTable)

        def selected_device(self) -> Found | None:
            table = self.selected_table()
            key = self._cursor_key(table)
            if not key:
                return None
            observed = self.devices.get(key)
            if observed:
                return observed
            saved = self.store.get(key)
            return saved.as_found() if saved else None

        def matches_auto(self, device: Found) -> bool:
            port = self._opts["port"]
            address = self._opts["address"]
            name = self._opts["name"]
            if port:
                return device.port == port
            if address:
                return bool(device.address) and (
                    device.address.lower() == address.lower())
            if name:
                return name.lower() in device.label.lower()
            return False

        def maybe_auto_connect(self, device: Found) -> None:
            if self.phase in {"connected", "connecting", "retrying"}:
                return
            saved = self.store.get(device.key)
            if saved and saved.auto_connect:
                self.start_session(device)

        def maybe_auto_connect_online(self) -> None:
            if self.phase in {"connected", "connecting", "retrying"}:
                return
            for saved in self.store.scanners.values():
                if not saved.auto_connect:
                    continue
                device = self.devices.get(saved.key)
                if device is not None:
                    self.start_session(device)
                    return

        def remember(self, device: Found) -> SavedScanner:
            saved = self.store.get(device.key)
            now = datetime.now().isoformat(timespec="seconds")
            if saved is None:
                saved = SavedScanner(
                    key=device.key, kind=device.kind, label=device.label,
                    port=device.port, address=device.address,
                    auto_connect=self.query_one("#auto", Switch).value,
                    reconnect=self.query_one("#reconnect", Switch).value,
                    baud=self.baud_from_widget(),
                    characteristic=self.characteristic_from_widget(),
                    last_connected=now,
                )
            else:
                if device.label and device.label != "(no name)":
                    saved.label = device.label
                saved.port = device.port or saved.port
                saved.address = device.address or saved.address
                saved.last_connected = now
            self.store.put(saved)
            self.rebuild_table()
            return saved

        def apply_saved_settings(self, saved: SavedScanner | None) -> None:
            self._loading_settings = True
            try:
                auto = self.query_one("#auto", Switch)
                reconnect = self.query_one("#reconnect", Switch)
                baud = self.query_one("#baud", Input)
                char = self.query_one("#characteristic", Input)
                if saved is None:
                    auto.value = False
                    return
                auto.value = saved.auto_connect
                reconnect.value = saved.reconnect
                baud.value = str(saved.baud)
                char.value = saved.characteristic or ""
            finally:
                self._loading_settings = False

        def persist_selected_settings(self) -> None:
            if self._loading_settings:
                return
            saved = self.store.get(self._settings_key)
            if saved is None:
                return
            saved.auto_connect = self.query_one("#auto", Switch).value
            saved.reconnect = self.query_one("#reconnect", Switch).value
            saved.baud = self.baud_from_widget()
            saved.characteristic = self.characteristic_from_widget()
            self.store.put(saved)
            self.rebuild_remembered()

        def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted
                                          ) -> None:
            if event.data_table.id == "remembered":
                key = event.row_key.value if event.row_key is not None else None
                self._settings_key = key
                self.apply_saved_settings(self.store.get(key))
            elif event.data_table.id == "nearby":
                self._settings_key = None
            elif event.data_table.id == "lookup-history":
                key = event.row_key.value if event.row_key is not None else None
                if key in self._hits_by_row:
                    scan, hit = self._hits_by_row[key]
                    self.show_hit(hit, scan=scan)

        def start_ble_scan(self) -> None:
            if not self.live or self._scanning:
                return
            self._scanning = True
            self.ble_scan()

        def stop_ble_scan(self) -> None:
            self._scanning = False
            self.workers.cancel_group(self, "ble-scan")

        @work(group="ble-scan", exclusive=True, exit_on_error=False)
        async def ble_scan(self) -> None:
            bleak = require("bleak")

            def detected(device, advert) -> None:
                self.post_message(BleSeen(device, advert))

            scanner = bleak.BleakScanner(detection_callback=detected)
            await scanner.start()
            try:
                while True:
                    await asyncio.sleep(1)
            finally:
                await scanner.stop()

        @work(group="serial-scan", exclusive=True, thread=True,
              exit_on_error=False)
        def watch_serial(self) -> None:
            worker = get_current_worker()
            while not worker.is_cancelled:
                self.post_message(SerialSnapshot(serial_ports()))
                time.sleep(1.5)

        def on_serial_snapshot(self, event: SerialSnapshot) -> None:
            present = {p.device for p in event.ports}
            for key, device in list(self.devices.items()):
                if (device.kind == "serial" and device.port not in present
                        and key != self.connected_key
                        and device.detail != "from --port"):
                    self.drop_device(key)
            for port in event.ports:
                self.upsert(Found(
                    kind="serial",
                    key=f"serial:{port.device}",
                    label=port.device,
                    detail=port.description or "",
                    port=port.device,
                ))

        def on_ble_seen(self, event: BleSeen) -> None:
            device, advert = event.device, event.advert
            services = " ".join(short_uuid(u) for u in advert.service_uuids)
            rssi = advert.rssi
            self.upsert(Found(
                kind="ble",
                key=f"ble:{device.address}",
                label=device.name or "(no name)",
                detail=services or device.address,
                rssi=rssi,
                address=device.address,
                ble_device=device,
            ))

        def on_input_changed(self, event: Input.Changed) -> None:
            if event.input.id == "filter":
                self.rebuild_table()
            elif event.input.id in {"baud", "characteristic"}:
                self.persist_selected_settings()

        def on_switch_changed(self, event: Switch.Changed) -> None:
            if event.switch.id == "unnamed":
                self.rebuild_nearby()
            elif event.switch.id in {"auto", "reconnect"}:
                self.persist_selected_settings()

        def on_data_table_row_selected(self, event: DataTable.RowSelected
                                       ) -> None:
            if event.data_table.id in {"nearby", "remembered"}:
                self.action_connect()

        def action_scan(self) -> None:
            if self.phase in {"connected", "connecting", "retrying"}:
                self.notify("Disconnect before scanning BLE again")
                return
            for key, device in list(self.devices.items()):
                if device.kind == "ble" and device.detail != "from --address":
                    self.devices.pop(key, None)
                    self.drop_nearby_row(key)
            self.rebuild_remembered()
            if not self.live:
                if self.phase != "connected":
                    self.set_phase("scanning",
                                   "scanning for devices · pull the trigger "
                                   "to wake a BLE scanner")
                return
            self.stop_ble_scan()
            if self.phase != "connected":
                self.set_phase("scanning",
                               "scanning for devices · pull the trigger "
                               "to wake a BLE scanner")
            self.start_ble_scan()
            self.post_message(SerialSnapshot(serial_ports()))

        def action_toggle_reconnect(self) -> None:
            self.query_one("#reconnect", Switch).toggle()

        def action_toggle_auto(self) -> None:
            device = self.selected_device()
            if device is None:
                self.notify("Select a device first")
                return
            saved = self.store.get(device.key)
            if saved is None:
                saved = self.remember(device)
                saved.auto_connect = True
                self.store.put(saved)
                self.rebuild_table()
            else:
                saved.auto_connect = not saved.auto_connect
                self.store.put(saved)
                self.rebuild_remembered()
            self.apply_saved_settings(saved)

        def action_forget(self) -> None:
            table = self.query_one("#remembered", DataTable)
            key = self._cursor_key(table) if table.has_focus else None
            if not key:
                device = self.selected_device()
                key = device.key if device else None
            if not key or self.store.get(key) is None:
                self.notify("Select a remembered device to forget")
                return
            self.store.forget(key)
            self.rebuild_table()
            self.apply_saved_settings(None)

        def action_toggle_unnamed(self) -> None:
            self.query_one("#unnamed", Switch).toggle()

        def action_clear_scans(self) -> None:
            if self.active_view() == "view-lookup":
                self.query_one("#lookup-history", DataTable).clear()
                self._hits_by_row.clear()
                self._lookup_seq = 0
                self.show_lookup_idle()
                return
            self.scan_count = 0
            self.query_one("#scans", Log).clear()
            self.refresh_status()

        def action_show_connections(self) -> None:
            self.query_one("#views", TabbedContent).active = "view-connections"

        def action_show_lookup(self) -> None:
            self.query_one("#views", TabbedContent).active = "view-lookup"

        def action_open_item(self) -> None:
            url = self.current_web_url()
            if not url:
                self.notify("Nothing to open — scan something first")
                return
            self.open_web(url)

        def on_button_pressed(self, event: Button.Pressed) -> None:
            if event.button.id == "lookup-open":
                self.action_open_item()

        def action_connect(self) -> None:
            device = self.selected_device()
            if device is None:
                self.notify("Select a device first")
                return
            if self.phase in {"connected", "connecting", "retrying"}:
                if self.connected_key == device.key:
                    return
                self.notify("Disconnect first (d), then connect")
                return
            self.start_session(device)

        def action_disconnect(self) -> None:
            self._want_session = False
            self._thread_stop.set()
            if self._async_stop is not None:
                self._async_stop.set()
            link = self._serial_link
            if link is not None:
                try:
                    link.close()
                except Exception:
                    pass
            self.workers.cancel_group(self, "session")
            self.connected_key = None
            self._ble_client = None
            self._serial_link = None
            self.rebuild_table()
            self.set_phase("scanning", "disconnected · scanning")
            self.start_ble_scan()

        def action_gatt(self) -> None:
            if self._ble_client is not None:
                title = self.status_text
                self.push_screen(GattScreen(title, format_gatt(self._ble_client)))
                return
            device = self.selected_device()
            if device is None or device.kind != "ble":
                self.notify("Select a BLE device to dump")
                return
            if self.phase in {"connecting", "connected", "retrying"}:
                self.notify("Disconnect first to dump a different device")
                return
            self.dump_gatt(device)

        def start_session(self, device: Found) -> None:
            self._want_session = True
            self._thread_stop = threading.Event()
            self._async_stop = asyncio.Event()
            self.connected_key = device.key
            saved = self.store.get(device.key)
            if saved is not None:
                self.apply_saved_settings(saved)
            self.rebuild_table()
            self.set_phase("connecting", f"connecting to {device.label}")
            if device.kind == "ble":
                self.stop_ble_scan()
            self.run_session(device)

        def note_state(self, text: str) -> None:
            self.post_message(LinkState(text, self.phase))

        def emit_scan(self, scan: str) -> None:
            self.post_message(ScanArrived(scan))

        def active_view(self) -> str:
            return self.query_one("#views", TabbedContent).active

        def inventree_api(self):
            if self._inventree_api is not None:
                return self._inventree_api
            if self._inventree_error:
                return None
            try:
                from invimport.env import DEFAULT_ENV_FILE, load_env_file
                from invimport.inventree.api import connect
                load_env_file(DEFAULT_ENV_FILE)
                self._inventree_api = connect()
                if not self._inventree_url:
                    self._inventree_url = os.getenv("INVENTREE_URL")
                return self._inventree_api
            except Exception as exc:
                self._inventree_error = str(exc)
                return None

        @work(group="inventree", exclusive=True, thread=True,
              exit_on_error=False)
        def connect_inventree(self) -> None:
            api = self.inventree_api()
            if api is None:
                self.post_message(LookupFailed(
                    "", self._inventree_error or LOOKUP_MISSING))

        def current_web_url(self) -> str | None:
            if self._current_hit is None:
                return None
            return web_url(self._inventree_url, self._current_hit.kind,
                           self._current_hit.pk)

        def open_web(self, url: str) -> None:
            if self._open_url is not None:
                self._open_url(url)
                return
            import webbrowser
            webbrowser.open(url)

        def navigate_location(self, pk: int, payload: dict | None = None
                              ) -> None:
            if (self._current_hit is not None
                    and self._current_hit.kind == "stocklocation"
                    and self._current_hit.pk == pk):
                return
            hit = location_hit(pk, payload)
            if self.live and self._lookup_fn is None:
                self.fetch_location(hit)
                return
            self.apply_lookup(f"location:{pk}", hit)

        @work(group="lookup", exclusive=True, thread=True, exit_on_error=False)
        def fetch_location(self, hit: BarcodeHit) -> None:
            try:
                api = self.inventree_api()
                shown = enrich_hit(api, hit) if api is not None else hit
                self.post_message(LookupReady(f"location:{hit.pk}", shown))
            except Exception as exc:
                self.post_message(LookupFailed(f"location:{hit.pk}", str(exc)))

        def clear_lookup_lists(self) -> None:
            self.query_one("#lookup-lists", Vertical).remove_children()

        def fill_lookup_lists(self, hit: BarcodeHit) -> None:
            lists = self.query_one("#lookup-lists", Vertical)
            lists.remove_children()
            if hit.kind == "stockitem":
                ref = location_ref(hit.payload)
                if ref is None:
                    return
                pk, label, payload = ref
                lists.mount(Horizontal(
                    Label("Location", classes="jump-label"),
                    LocationName(label, pk, payload),
                    classes="jump-row",
                ))
                return
            if hit.kind == "part":
                items = [item for item in (hit.payload.get("stock_items") or [])
                         if isinstance(item, dict)]
                if not items:
                    return
                lists.mount(Label(f"Stock ({len(items)})", classes="panel-header"))
                for item in items:
                    qty = format_count(
                        item.get("quantity") if item.get("quantity") not in (None, "")
                        else 0)
                    extra = " · ".join(
                        str(bit) for bit in (
                            item.get("serial") and f"SN {item['serial']}",
                            item.get("batch") and f"batch {item['batch']}",
                            item.get("status_text"),
                        ) if bit)
                    cells: list = [Label(qty, classes="stock-qty")]
                    ref = location_ref(item)
                    if ref is not None:
                        pk, label, payload = ref
                        cells.append(LocationName(label, pk, payload))
                    else:
                        cells.append(Label("—"))
                    if extra:
                        cells.append(Label(extra, classes="stock-extra"))
                    lists.mount(Horizontal(*cells, classes="stock-jump-row"))
                return
            if hit.kind != "stocklocation":
                return
            children = [child for child in (hit.payload.get("children") or [])
                        if isinstance(child, dict)]
            if children:
                lists.mount(Label(f"Locations ({len(children)})",
                                  classes="panel-header"))
                for child in children:
                    ref = child_location_ref(child)
                    if ref is None:
                        continue
                    pk, label, payload = ref
                    lists.mount(Horizontal(
                        LocationName(label, pk, payload),
                        classes="jump-row",
                    ))
            items = [item for item in (hit.payload.get("stock_items") or [])
                     if isinstance(item, dict)]
            if not items:
                return
            lists.mount(Label(f"Stock ({len(items)}) — enter to expand",
                              classes="panel-header"))
            for item in items:
                details = Static(render_section(
                    DetailSection("Details", stock_expand_fields(item))))
                lists.mount(Collapsible(
                    details,
                    title=stock_line(item),
                    collapsed=True,
                ))

        def show_lookup_message(self, markdown: str) -> None:
            self.query_one("#lookup-md", Markdown).update(markdown)
            self.query_one("#lookup-md", Markdown).display = True
            pretty = self.query_one("#lookup-pretty", Static)
            pretty.update("")
            pretty.display = False
            self.clear_lookup_lists()
            link = self.query_one("#lookup-link", Link)
            link.url = ""
            link.display = False
            self.query_one("#lookup-open", Button).disabled = True

        def show_lookup_idle(self) -> None:
            self._current_hit = None
            self.query_one("#lookup-title", Label).update(
                "Scan a location, stock item or part")
            self.show_lookup_message(LOOKUP_IDLE)

        def show_lookup_error(self, scan: str, error: str) -> None:
            self._current_hit = None
            title = "InvenTree is not configured" if not scan else (
                f"Could not look up {printable(scan)}")
            self.query_one("#lookup-title", Label).update(title)
            self.show_lookup_message(error or LOOKUP_MISSING)

        def show_hit(self, hit: BarcodeHit | None, scan: str = "") -> None:
            if hit is not None and hit is self._current_hit:
                return
            self._current_hit = hit
            if hit is None:
                shown = printable(scan) if scan else "(empty)"
                self.query_one("#lookup-title", Label).update(
                    f"{shown} is not in InvenTree")
                self.show_lookup_message(
                    f"`{shown}` did not match a part, stock item or location.")
                return
            url = web_url(self._inventree_url, hit.kind, hit.pk)
            self.query_one("#lookup-title", Label).update(
                f"{hit.type_label} · {hit.title}")
            self.query_one("#lookup-md", Markdown).display = False
            pretty = self.query_one("#lookup-pretty", Static)
            pretty.display = True
            pretty.update(render_hit(hit, lists=False, include_location=False))
            self.fill_lookup_lists(hit)
            link = self.query_one("#lookup-link", Link)
            if url:
                link.update(url)
                link.url = url
                link.display = True
            else:
                link.url = ""
                link.display = False
            button = self.query_one("#lookup-open", Button)
            button.disabled = url is None

        def record_lookup(self, scan: str, hit: BarcodeHit | None) -> None:
            self._lookup_seq += 1
            key = str(self._lookup_seq)
            self._hits_by_row[key] = (scan, hit)
            table = self.query_one("#lookup-history", DataTable)
            stamp = datetime.now().strftime("%H:%M:%S")
            kind = hit.type_label if hit else "—"
            title = hit.title if hit else "not in InvenTree"
            table.add_row(stamp, kind, printable(scan), title, key=key)

        def apply_lookup(self, scan: str, hit: BarcodeHit | None) -> None:
            self.record_lookup(scan, hit)
            self.show_hit(hit, scan=scan)
            self.query_one("#views", TabbedContent).active = "view-lookup"

        def on_scan_arrived(self, event: ScanArrived) -> None:
            self.scan_count += 1
            stamp = datetime.now().strftime("%H:%M:%S")
            self.query_one("#scans", Log).write_line(
                f"{stamp}  {self.scan_count:>4}  {printable(event.scan)}")
            self.refresh_status()
            if self._lookup_fn is not None:
                try:
                    self.apply_lookup(event.scan, self._lookup_fn(event.scan))
                except Exception as exc:
                    self.query_one("#views", TabbedContent).active = (
                        "view-lookup")
                    self.show_lookup_error(event.scan, str(exc))
            elif self.live:
                self.lookup_scan(event.scan)

        def on_lookup_ready(self, event: LookupReady) -> None:
            self.apply_lookup(event.scan, event.hit)

        def on_lookup_failed(self, event: LookupFailed) -> None:
            if event.scan:
                self.query_one("#views", TabbedContent).active = "view-lookup"
            self.show_lookup_error(event.scan, event.error)

        @work(group="lookup", exclusive=True, thread=True, exit_on_error=False)
        def lookup_scan(self, scan: str) -> None:
            try:
                api = self.inventree_api()
                if api is None:
                    self.post_message(LookupFailed(
                        scan, self._inventree_error or LOOKUP_MISSING))
                    return
                self.post_message(LookupReady(scan, lookup_barcode(api, scan)))
            except Exception as exc:
                self.post_message(LookupFailed(scan, str(exc)))

        def on_link_state(self, event: LinkState) -> None:
            if event.phase == "connected" and self.connected_key:
                device = self.devices.get(self.connected_key)
                if device is None:
                    saved = self.store.get(self.connected_key)
                    device = saved.as_found() if saved else None
                if device is not None:
                    self.remember(device)
            if event.phase == "error":
                self.connected_key = None
                self.rebuild_table()
            self.set_phase(event.phase, event.text)
            if event.phase in {"connected", "connecting", "retrying"}:
                self.rebuild_remembered()

        def on_log_note(self, event: LogNote) -> None:
            self.query_one("#scans", Log).write_line(event.text)

        def on_gatt_ready(self, event: GattReady) -> None:
            self.push_screen(GattScreen(event.title, event.body))

        def on_worker_state_changed(self, event: Worker.StateChanged) -> None:
            if event.worker.group != "session":
                return
            if event.state is WorkerState.ERROR and event.worker.error:
                self.set_phase("error", reason(event.worker.error))
                self.connected_key = None
                self.rebuild_table()
                self.start_ble_scan()

        @work(group="session", exclusive=True, exit_on_error=False)
        async def run_session(self, device: Found) -> None:
            delay = FIRST_RETRY
            while self._want_session:
                try:
                    if device.kind == "serial":
                        await asyncio.to_thread(
                            self._serial_loop, device,
                            self.session_baud(device))
                    else:
                        await self._ble_loop(device)
                    trouble, was_connected = "session ended", True
                except ConfigError as exc:
                    self.post_message(LogNote(str(exc)))
                    self.post_message(LinkState(reason(exc).splitlines()[0],
                                                "error"))
                    self._want_session = False
                    self.start_ble_scan()
                    return
                except Unavailable as exc:
                    trouble, was_connected = reason(exc), exc.connected
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    trouble, was_connected = f"error: {reason(exc)}", False

                self._ble_client = None
                self._serial_link = None
                if not self._want_session:
                    return
                if not self.session_reconnect(device):
                    self.connected_key = None
                    self.post_message(LinkState(trouble, "error"))
                    self.start_ble_scan()
                    return
                if was_connected:
                    delay = FIRST_RETRY
                self.post_message(LinkState(
                    f"{trouble} · retrying in {delay:.0f}s", "retrying"))
                try:
                    await asyncio.sleep(delay)
                except asyncio.CancelledError:
                    raise
                delay = min(delay * 2, MAX_RETRY)

        def _serial_loop(self, device: Found, baud: int) -> None:
            def opened(link) -> None:
                self._serial_link = link

            serial_session(
                device.port, baud,
                self.emit_scan,
                lambda msg: self.post_message(LinkState(msg, "connected")),
                stop=self._thread_stop,
                on_open=opened,
            )

        async def _ble_loop(self, device: Found) -> None:
            def opened(client) -> None:
                self._ble_client = client

            await ble_session(
                device.label if device.label != "(no name)" else None,
                device.address,
                self.session_characteristic(device),
                self._opts["timeout"],
                self.emit_scan,
                lambda msg: self.post_message(LinkState(msg, "connected")),
                known=device.ble_device,
                stop=self._async_stop,
                on_open=opened,
            )

        @work(group="gatt", exclusive=True, exit_on_error=False)
        async def dump_gatt(self, device: Found) -> None:
            bleak = require("bleak")
            self.set_phase("connecting", f"dumping GATT on {device.label}")
            self.stop_ble_scan()
            target = device.ble_device
            try:
                if target is None and device.address:
                    target = await find_device(
                        bleak, None, device.address, self._opts["timeout"])
                if target is None:
                    raise Unavailable(f"no BLE device matching {device.label}")
                async with bleak.BleakClient(target) as client:
                    body = format_gatt(client)
                    title = (f"{device.label} "
                             f"({device.address or target.address})")
                    self.post_message(GattReady(title, body))
                    self.set_phase("scanning", "GATT dump · scanning")
            except Exception as exc:
                self.notify(reason(exc), severity="error")
                self.set_phase("error", reason(exc))
            finally:
                self.start_ble_scan()

    _TUI = SimpleNamespace(
        ScannerApp=ScannerApp,
        ScanArrived=ScanArrived,
        LinkState=LinkState,
        SerialSnapshot=SerialSnapshot,
        BleSeen=BleSeen,
        GattReady=GattReady,
        LogNote=LogNote,
        LookupReady=LookupReady,
        LookupFailed=LookupFailed,
        GattScreen=GattScreen,
        LocationName=LocationName,
        BarcodeHit=BarcodeHit,
    )
    return _TUI


def run_tui(*, baud: int, reconnect: bool, timeout: float,
            characteristic: str | None, name: str | None,
            address: str | None, port: str | None) -> int:
    require("serial")
    require("bleak")
    tui().ScannerApp(
        baud=baud, reconnect=reconnect, timeout=timeout,
        characteristic=characteristic, name=name,
        address=address, port=port,
    ).run()
    return 0


# --------------------------------------------------------------------------
def run_cli(args) -> int:
    source = args.source
    if source == "auto":
        # An address names a BLE device, so asking for one settles it.
        # Under --forever a missing port is not evidence of anything: the
        # scanner may simply not be switched on yet, so an explicitly
        # chosen source is the only thing that decides it.
        source = "ble" if args.address else (
            "serial" if (args.port or serial_ports()) else "ble")

    on_scan = printer()
    state = reporter()
    if source == "serial":
        def attempt() -> None:
            serial_session(args.port, args.baud, on_scan, state)
        hint = SERIAL_HINT
    else:
        def attempt() -> None:
            asyncio.run(ble_session(args.name, args.address,
                                    args.characteristic, args.timeout,
                                    on_scan, state))
        hint = BLE_HINT
    return supervise(attempt, args.forever, state, hint)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=("auto", "serial", "ble"),
                        default="auto",
                        help="transport (default: serial if a port is there)")
    parser.add_argument("--forever", action="store_true",
                        help="never exit: wait for the scanner, and reconnect "
                             "whenever it drops (Ctrl-C / q stops it)")
    parser.add_argument("--port", metavar="DEV",
                        help="serial device, e.g. /dev/cu.usbmodem1101")
    parser.add_argument("--baud", type=int, default=9600,
                        help="serial speed (default: the scanner's own 9600)")
    parser.add_argument("--name",
                        help="substring of the BLE device name to connect to; "
                             "there is no default, use --list to find it")
    parser.add_argument("--characteristic", metavar="UUID",
                        help="BLE characteristic to subscribe to "
                             "(default: whichever one notifies)")
    parser.add_argument("--timeout", type=float, default=15.0, metavar="SECS",
                        help="how long to look for a BLE device")
    parser.add_argument("--address", metavar="ADDR",
                        help="BLE address from --list, instead of a name")
    parser.add_argument("--dump", action="store_true",
                        help="print the BLE device's services and "
                             "characteristics, then exit")
    parser.add_argument("--list", action="store_true",
                        help="show serial ports and BLE devices, then exit")
    parser.add_argument("--cli", action="store_true",
                        help="print scans to stdout instead of opening the TUI")
    args = parser.parse_args()

    try:
        if args.list:
            return asyncio.run(list_sources(args.name, args.timeout))
        if args.dump:
            return asyncio.run(
                dump_gatt(args.name, args.address, args.timeout))

        want_tui = not args.cli
        if want_tui and not sys.stdout.isatty():
            print("Need a terminal for the live interface. "
                  "Use --list, --dump or --cli.", file=sys.stderr)
            return 1
        if want_tui:
            return run_tui(
                baud=args.baud, reconnect=args.forever,
                timeout=args.timeout, characteristic=args.characteristic,
                name=args.name, address=args.address, port=args.port)
        return run_cli(args)
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python
"""
Print barcode scans as they arrive, straight from the scanner.

    uv run scripts/register-scans.py            # find the scanner, show scans
    uv run scripts/register-scans.py --forever  # and never give up on it
    uv run scripts/register-scans.py --list     # what there is to connect to
    uv run scripts/register-scans.py --dump --address ADDR   # its BLE services
    uv run scripts/register-scans.py --source serial --port /dev/cu.usbmodem1101

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

--forever is for leaving this running in the background all day. Nothing short
of Ctrl-C stops it: a scanner that is off, out of range, asleep or not paired
yet is a thing to wait for rather than an error, so it retries with a backoff
and reconnects on its own when the scanner comes back. Without --forever the
first such problem exits, which is what you want when running it by hand.

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
import sys
import time
from datetime import datetime
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
MAX_RETRY = 15.0

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
                   state: Callable[[str], None]) -> None:
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
            connected = True
            state(f"listening on {target} at {baud} baud")
            # Outside the loop: a scan split across two reads is reassembled
            # here, so a fresh buffer per read would tear every one of them.
            buf = ScanBuffer()
            while True:
                data = link.read(link.in_waiting or 1)
                for scan in (buf.feed(data) if data else buf.idle()):
                    on_scan(scan)
    except OSError as exc:
        # SerialException is an OSError, as is the port vanishing mid-read
        # when the Bluetooth link drops.
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
        raise SystemExit(
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
    raise SystemExit(
        f"Several characteristics notify - pick one with --characteristic:\n"
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
                      state: Callable[[str], None]) -> None:
    """Subscribe and read scans until the link drops. Never returns."""
    require_target(name, address)
    bleak = require("bleak")
    state(f"looking for {address or name!r}")
    device = await find_device(bleak, name, address, timeout)
    if device is None:
        raise Unavailable(f"no BLE device matching {address or name!r}")

    buf = ScanBuffer()
    connected = False
    try:
        async with bleak.BleakClient(device) as client:
            char = pick_notify(client, chosen)

            def arrived(_, data: bytearray) -> None:
                for scan in buf.feed(bytes(data)):
                    on_scan(scan)

            await client.start_notify(char, arrived)
            connected = True
            state(f"connected to {device.name or device.address} on {char}")
            while client.is_connected:
                # Also the tick that closes off a scan with no terminator.
                await asyncio.sleep(IDLE_GAP)
                for scan in buf.idle():
                    on_scan(scan)
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


async def dump_gatt(name: str | None, address: str | None,
                    timeout: float) -> int:
    """Every service and characteristic, for working out which one carries
    scans. Netum publishes no GATT documentation, so this is the way in."""
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
        for service in client.services:
            print(f"  service {service.uuid}  {service.description}")
            for char in service.characteristics:
                props = ",".join(char.properties)
                print(f"    {char.uuid}  {props:<34} {char.description}")
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
def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=("auto", "serial", "ble"),
                        default="auto",
                        help="transport (default: serial if a port is there)")
    parser.add_argument("--forever", action="store_true",
                        help="never exit: wait for the scanner, and reconnect "
                             "whenever it drops (Ctrl-C stops it)")
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
    args = parser.parse_args()

    try:
        if args.list:
            return asyncio.run(list_sources(args.name, args.timeout))
        if args.dump:
            return asyncio.run(
                dump_gatt(args.name, args.address, args.timeout))

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
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

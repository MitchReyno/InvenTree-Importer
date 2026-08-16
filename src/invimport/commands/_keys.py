"""
Raw-mode key reading for the interactive prompts.

Terminals deliver arrow keys as escape sequences, and only in raw (cbreak)
mode - line mode would sit on them until ENTER. This module owns that: putting
the terminal into cbreak, decoding one keypress at a time, and putting the
terminal back however the caller leaves.

POSIX only, and only when both ends really are a terminal. supported() says
whether that holds; when it does not the caller falls back to a prompt that
reads whole lines, which works anywhere - over a pipe, in a dumb terminal, and
under pytest.

Decoding is split from reading so the key map can be tested without a tty:
read_key() takes anything with read_char() and ready().
"""

from __future__ import annotations

import contextlib
import os
import select
import sys
from typing import Iterator, Protocol

# What a keypress means. Strings rather than an enum so a failing assertion
# reads as 'up' instead of '<Key.UP: 1>'.
UP = "up"
DOWN = "down"
TOP = "top"
BOTTOM = "bottom"
PAGE_UP = "page-up"
PAGE_DOWN = "page-down"
TOGGLE = "toggle"
SUBMIT = "submit"
CANCEL = "cancel"
ALL = "all"
NONE = "none"
UNKNOWN = "unknown"

ESC = "\x1b"

# How long to wait for the rest of an escape sequence before deciding the user
# pressed ESC on its own. Long enough for the terminal to deliver the rest,
# short enough that a real ESC does not feel stuck.
ESC_TIMEOUT_S = 0.05

# Arrow and navigation keys. Terminals send [ in normal cursor mode and O in
# application cursor mode; both spellings turn up in practice.
SEQUENCES = {
    "[A": UP, "OA": UP,
    "[B": DOWN, "OB": DOWN,
    "[5~": PAGE_UP,
    "[6~": PAGE_DOWN,
    "[H": TOP, "OH": TOP, "[1~": TOP,
    "[F": BOTTOM, "OF": BOTTOM, "[4~": BOTTOM,
}

# Plain keypresses. j/k and g/G are here because anyone who lives in vim will
# try them before they try the arrows.
KEYS = {
    " ": TOGGLE,
    "\r": SUBMIT,
    "\n": SUBMIT,
    "\x03": CANCEL,          # Ctrl-C
    "\x04": CANCEL,          # Ctrl-D
    "q": CANCEL, "Q": CANCEL,
    "a": ALL, "A": ALL,
    "n": NONE, "N": NONE,
    "j": DOWN, "k": UP,
    "g": TOP, "G": BOTTOM,
}


class Reader(Protocol):
    """Where keypresses come from. Real stdin, or a scripted list in tests."""

    def read_char(self) -> str:
        """One character, or "" at end of input."""

    def ready(self, timeout: float) -> bool:
        """Is there more input waiting within timeout seconds?"""


class StdinReader:
    """Reads single characters straight off a file descriptor."""

    def __init__(self, fd: int | None = None):
        self.fd = sys.stdin.fileno() if fd is None else fd

    def read_char(self) -> str:
        try:
            data = os.read(self.fd, 1)
        except (OSError, ValueError):
            return ""
        # Only ASCII keys mean anything here; anything else becomes UNKNOWN
        # rather than raising on a stray byte.
        return data.decode("utf-8", "replace") if data else ""

    def ready(self, timeout: float) -> bool:
        try:
            return bool(select.select([self.fd], [], [], timeout)[0])
        except (OSError, ValueError):
            return False


def read_key(reader: Reader) -> str:
    """Block for one keypress and return what it means."""
    char = reader.read_char()
    if char == "":
        return CANCEL                        # end of input: back out
    if char != ESC:
        return KEYS.get(char, UNKNOWN)

    # ESC alone means cancel; ESC followed by more means an arrow key. The
    # only way to tell them apart is to wait a moment and see.
    if not reader.ready(ESC_TIMEOUT_S):
        return CANCEL

    sequence = ""
    for _ in range(4):
        char = reader.read_char()
        if char == "":
            break
        sequence += char
        if sequence in SEQUENCES:
            return SEQUENCES[sequence]
        # A letter or ~ terminates a sequence: if it is not known by now, it
        # never will be, and reading on would eat the next keypress. The first
        # character is the introducer ([ or O) and never terminates - treating
        # it as one loses every application-cursor-mode arrow key.
        if len(sequence) > 1 and (char.isalpha() or char == "~"):
            break
    return UNKNOWN


# Set this to force the line-reading prompt: an escape hatch for a terminal
# that mangles the cursor version, and what the test suite uses so its results
# do not depend on whether pytest happened to capture stdout.
PLAIN_ENV_VAR = "INVIMPORT_PLAIN_PROMPT"


def supported(stdin=None, stdout=None) -> bool:
    """
    Can we take over the terminal?

    Both ends have to be a real tty - a piped stdout means the drawing would
    land in a file - and the platform has to have termios.
    """
    if os.environ.get(PLAIN_ENV_VAR, "").strip() not in ("", "0", "false"):
        return False
    if os.name != "posix":
        return False
    if os.environ.get("TERM", "").lower() in ("", "dumb"):
        return False
    try:
        import termios  # noqa: F401
        import tty  # noqa: F401
    except ImportError:
        return False

    for stream in (stdin or sys.stdin, stdout or sys.stdout):
        try:
            if not stream.isatty():
                return False
            stream.fileno()
        except (AttributeError, ValueError, OSError):
            return False
    return True


@contextlib.contextmanager
def raw_mode(fd: int) -> Iterator[None]:
    """
    Put the terminal in cbreak for the duration, and always put it back.

    cbreak rather than full raw: it leaves signal handling on, so Ctrl-C still
    interrupts instead of being delivered as a byte nobody is watching for.
    Restoring in a finally matters more than usual here - an exception escaping
    with the terminal still in cbreak leaves the user's shell without an echo.

    setcbreak flushes pending input as it switches (TCSAFLUSH, its default),
    which is what we want: anything typed before the checklist appeared is
    discarded rather than arriving as toggles nobody meant. Keep it that way -
    this prompt decides what gets written to InvenTree.
    """
    import termios
    import tty

    saved = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        yield
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)

"""Raw-mode key reading: decoding, capability detection, terminal restore."""

from __future__ import annotations

import os

import pytest

from invimport.commands import _keys as keys
from invimport.commands._keys import StdinReader, raw_mode, read_key, supported

posix_only = pytest.mark.skipif(os.name != "posix", reason="needs termios")


class ScriptedReader:
    """Serves a canned string one character at a time."""

    def __init__(self, text: str):
        self.chars = list(text)

    def read_char(self) -> str:
        return self.chars.pop(0) if self.chars else ""

    def ready(self, timeout: float) -> bool:
        return bool(self.chars)


# --------------------------------------------------------------------------
# Decoding
# --------------------------------------------------------------------------
@pytest.mark.parametrize("sent,expected", [
    ("\x1b[A", keys.UP),
    ("\x1b[B", keys.DOWN),
    ("\x1b[C", keys.RIGHT),
    ("\x1b[D", keys.LEFT),
    ("\x1bOA", keys.UP),                 # application cursor mode
    ("\x1bOB", keys.DOWN),
    ("\x1bOC", keys.RIGHT),
    ("\x1bOD", keys.LEFT),
    ("\x1b[5~", keys.PAGE_UP),
    ("\x1b[6~", keys.PAGE_DOWN),
    ("\x1b[H", keys.TOP),
    ("\x1b[F", keys.BOTTOM),
    (" ", keys.TOGGLE),
    ("\r", keys.SUBMIT),
    ("\n", keys.SUBMIT),
    ("q", keys.CANCEL),
    ("Q", keys.CANCEL),
    ("a", keys.ALL),
    ("n", keys.NONE),
    ("j", keys.DOWN),
    ("k", keys.UP),
    ("h", keys.LEFT),
    ("l", keys.RIGHT),
    ("\x7f", keys.LEFT),                 # backspace
    ("\x08", keys.LEFT),
    ("g", keys.TOP),
    ("G", keys.BOTTOM),
    ("\x03", keys.CANCEL),               # Ctrl-C
    ("\x04", keys.CANCEL),               # Ctrl-D
    ("z", keys.UNKNOWN),
])
def test_read_key(sent, expected):
    assert read_key(ScriptedReader(sent)) == expected


def test_a_bare_escape_cancels():
    """ESC alone is a cancel; ESC plus more is an arrow key."""
    assert read_key(ScriptedReader("\x1b")) == keys.CANCEL


def test_end_of_input_cancels():
    assert read_key(ScriptedReader("")) == keys.CANCEL


def test_an_unknown_sequence_does_not_eat_the_next_key():
    """
    A sequence has to stop at its terminator. Reading past it would swallow
    whatever the user pressed next.
    """
    reader = ScriptedReader("\x1b[Z ")           # shift-tab, then space
    assert read_key(reader) == keys.UNKNOWN
    assert read_key(reader) == keys.TOGGLE


def test_keys_are_read_one_at_a_time():
    reader = ScriptedReader("\x1b[B \r")
    assert [read_key(reader) for _ in range(3)] == [keys.DOWN, keys.TOGGLE,
                                                    keys.SUBMIT]


# --------------------------------------------------------------------------
# Capability detection
# --------------------------------------------------------------------------
class FakeStream:
    def __init__(self, tty: bool):
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty

    def fileno(self) -> int:
        return 0


@posix_only
def test_supported_needs_a_terminal_at_both_ends(monkeypatch):
    monkeypatch.setenv("TERM", "xterm-256color")
    monkeypatch.delenv(keys.PLAIN_ENV_VAR, raising=False)
    assert supported(FakeStream(True), FakeStream(True)) is True
    assert supported(FakeStream(True), FakeStream(False)) is False
    assert supported(FakeStream(False), FakeStream(True)) is False


@posix_only
def test_a_dumb_terminal_is_not_supported(monkeypatch):
    monkeypatch.delenv(keys.PLAIN_ENV_VAR, raising=False)
    monkeypatch.setenv("TERM", "dumb")
    assert supported(FakeStream(True), FakeStream(True)) is False


@posix_only
def test_the_plain_override_wins(monkeypatch):
    monkeypatch.setenv("TERM", "xterm-256color")
    monkeypatch.setenv(keys.PLAIN_ENV_VAR, "1")
    assert supported(FakeStream(True), FakeStream(True)) is False


@posix_only
@pytest.mark.parametrize("value", ["", "0", "false"])
def test_the_plain_override_is_off_for_falsey_values(monkeypatch, value):
    monkeypatch.setenv("TERM", "xterm-256color")
    monkeypatch.setenv(keys.PLAIN_ENV_VAR, value)
    assert supported(FakeStream(True), FakeStream(True)) is True


def test_a_stream_without_a_descriptor_is_not_supported(monkeypatch):
    monkeypatch.setenv("TERM", "xterm-256color")
    monkeypatch.delenv(keys.PLAIN_ENV_VAR, raising=False)

    class NoFileno(FakeStream):
        def fileno(self):
            raise ValueError("not a real stream")

    assert supported(NoFileno(True), FakeStream(True)) is False


# --------------------------------------------------------------------------
# Against a real pty
# --------------------------------------------------------------------------
def line_mode(fd) -> tuple[bool, bool]:
    """
    Is the terminal echoing and line-buffering?

    Compared instead of the whole termios struct because the kernel sets
    PENDIN itself during tcsetattr, so a faithful restore is never bit-for-bit
    equal. Echo and canonical mode are what the user would actually notice.
    """
    import termios

    lflag = termios.tcgetattr(fd)[3]
    return bool(lflag & termios.ICANON), bool(lflag & termios.ECHO)


@posix_only
def test_raw_mode_restores_the_terminal():
    """
    The important guarantee: however the block exits, the terminal goes back
    as it was. Leaving cbreak on would strand the user's shell without echo.
    """
    import pty

    controller, follower = pty.openpty()
    try:
        assert line_mode(follower) == (True, True)
        with raw_mode(follower):
            assert line_mode(follower) == (False, False)
        assert line_mode(follower) == (True, True)
    finally:
        os.close(controller)
        os.close(follower)


@posix_only
def test_raw_mode_restores_after_an_exception():
    import pty

    controller, follower = pty.openpty()
    try:
        with pytest.raises(RuntimeError):
            with raw_mode(follower):
                raise RuntimeError("boom")
        assert line_mode(follower) == (True, True)
    finally:
        os.close(controller)
        os.close(follower)


@posix_only
def test_reads_a_real_arrow_key_off_a_pty():
    """End to end through the OS: a terminal really does send \\x1b[B."""
    import pty

    controller, follower = pty.openpty()
    try:
        with raw_mode(follower):
            os.write(controller, b"\x1b[B \r")
            reader = StdinReader(follower)
            assert read_key(reader) == keys.DOWN
            assert read_key(reader) == keys.TOGGLE
            assert read_key(reader) == keys.SUBMIT
    finally:
        os.close(controller)
        os.close(follower)


@posix_only
def test_a_closed_descriptor_reads_as_a_cancel():
    """A vanished terminal must back out, not raise into the command."""
    import pty

    controller, follower = pty.openpty()
    os.close(controller)
    os.close(follower)
    assert read_key(StdinReader(follower)) == keys.CANCEL

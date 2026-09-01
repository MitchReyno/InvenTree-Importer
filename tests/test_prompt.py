"""The interactive prompt primitives."""

from __future__ import annotations

import re

import pytest

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def visible(text: str) -> str:
    """What a row occupies on screen, with the escape codes taken out."""
    return ANSI.sub("", text)

from invimport.commands import _fancy
from invimport.commands import _keys as keys
from invimport.commands._prompt import (
    Menu,
    choose_one,
    choose_row,
    confirm,
    interactive,
    menu_frame,
    parse_selection,
    question_and_context,
    redraw,
    run_menu_cursor,
    select_many,
)

ITEMS = ["alpha", "beta", "gamma", "delta"]


def render(item: str) -> str:
    return item


# --------------------------------------------------------------------------
# parse_selection
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text,expected", [
    ("1", {0}),
    ("1 3", {0, 2}),
    ("1,3", {0, 2}),
    ("2-4", {1, 2, 3}),
    ("4-2", {1, 2, 3}),                  # backwards ranges still work
    ("1 3-4", {0, 2, 3}),
    ("", set()),
])
def test_parse_selection(text, expected):
    assert parse_selection(text, 4)[0] == expected


@pytest.mark.parametrize("text", ["9", "0", "x", "2-", "a-b"])
def test_out_of_range_and_nonsense_is_reported(text):
    """A typo that silently selects nothing is worse than one that complains."""
    chosen, bad = parse_selection(text, 4)
    assert chosen == set()
    assert bad == [text]


def test_a_range_is_clipped_to_what_exists():
    chosen, bad = parse_selection("3-99", 4)
    assert chosen == {2, 3}
    assert bad == []


# --------------------------------------------------------------------------
# select_many
# --------------------------------------------------------------------------
def test_everything_starts_selected_and_enter_submits(answers):
    answers("")
    assert select_many(ITEMS, render, title="t") == ITEMS


def test_a_number_unselects(answers):
    answers("2", "")
    assert select_many(ITEMS, render, title="t") == ["alpha", "gamma", "delta"]


def test_the_same_number_twice_reselects(answers):
    """Toggling is what makes one input do both select and unselect."""
    answers("2", "2", "")
    assert select_many(ITEMS, render, title="t") == ITEMS


def test_none_then_a_range_selects_just_those(answers):
    answers("n", "2-3", "")
    assert select_many(ITEMS, render, title="t") == ["beta", "gamma"]


def test_all_reselects_everything(answers):
    answers("n", "a", "")
    assert select_many(ITEMS, render, title="t") == ITEMS


def test_submitting_an_empty_selection_is_refused(answers, capsys):
    answers("n", "", "1", "")
    assert select_many(ITEMS, render, title="t") == ["alpha"]
    assert "nothing selected" in capsys.readouterr().out


def test_q_cancels(answers):
    answers("q")
    assert select_many(ITEMS, render, title="t") is None


def test_eof_cancels(answers):
    """Ctrl-D must back out, not raise into the command."""
    assert select_many(ITEMS, render, title="t") is None


def test_bad_input_is_reported_and_the_prompt_stays_up(answers, capsys):
    answers("zzz", "")
    select_many(ITEMS, render, title="t")
    assert "ignored: zzz" in capsys.readouterr().out


def test_an_empty_list_needs_no_prompt():
    assert select_many([], render, title="t") == []


def test_the_checklist_shows_marks_and_a_count(answers, capsys):
    answers("2", "")
    select_many(ITEMS, render, title="Orders found (4):")
    out = capsys.readouterr().out
    assert "Orders found (4):" in out
    assert "1 [x] alpha" in out
    assert "2 [ ] beta" in out
    assert "3 of 4 selected" in out


# --------------------------------------------------------------------------
# question_and_context
# --------------------------------------------------------------------------
def test_a_single_line_title_is_the_question():
    question, context = question_and_context("Orders found (4):")
    assert question == "Orders found (4):"
    assert context == ""


def test_a_multiline_title_becomes_context_and_the_prompt_is_the_question():
    title = ("Resistors\n"
             "  Resistance  (on 12 products)\n"
             "  values: 10k")
    question, context = question_and_context(title, prompt="  file as > ")
    assert question == "file as"
    assert context.startswith("Resistors")
    assert "10k" in context


# --------------------------------------------------------------------------
# Redraw
# --------------------------------------------------------------------------
def test_the_first_frame_does_not_move_the_cursor_up():
    """Nothing has been drawn yet, so there is nothing to rewind over."""
    out = redraw(["a", "b"], previous=0)
    assert not re.match(r"\x1b\[\d+A", out)
    assert out == "\x1b[2Ka\n\x1b[2Kb\n"


def test_a_later_frame_rewinds_over_the_last_one():
    assert redraw(["a", "b"], previous=2).startswith("\x1b[2A")


def test_a_shrinking_frame_blanks_the_rows_it_gave_up():
    """Otherwise the tail of the previous, longer frame stays on screen."""
    out = redraw(["a"], previous=3)
    assert out.startswith("\x1b[3A")
    assert out.count("\x1b[2K") == 3          # one real row, two blanked
    assert out.endswith("\x1b[2A")            # and back to where it began


# --------------------------------------------------------------------------
# Which front-end gets used
# --------------------------------------------------------------------------
def test_the_plain_version_is_used_without_a_terminal(answers, capsys):
    """The answers fixture forces plain; proves the fallback is wired up."""
    answers("")
    assert select_many(ITEMS, render, title="t") == ITEMS
    assert "toggle: numbers or ranges" in capsys.readouterr().out


def test_plain_can_be_asked_for_explicitly(answers, capsys, monkeypatch):
    monkeypatch.setattr(_fancy, "supported", lambda *a, **k: True)
    answers("")
    assert select_many(ITEMS, render, title="t", plain=True) == ITEMS
    assert "toggle: numbers or ranges" in capsys.readouterr().out


def test_the_fancy_version_is_used_when_the_terminal_allows(monkeypatch):
    seen = {}

    def fake_select(items, render, *, message, verb, selected, context):
        seen["items"] = list(items)
        seen["message"] = message
        return list(items)

    monkeypatch.setattr(_fancy, "supported", lambda *a, **k: True)
    monkeypatch.setattr(_fancy, "select_many", fake_select)
    assert select_many(ITEMS, render, title="Orders found (4):") == ITEMS
    assert seen["items"] == ITEMS
    assert seen["message"] == "Orders found (4):"


def test_choose_one_uses_the_fancy_version_when_the_terminal_allows(monkeypatch):
    seen = {}

    def fake_choose(options, render, *, message, context, fuzzy):
        seen["options"] = list(options)
        seen["fuzzy"] = fuzzy
        seen["context"] = context
        return options[1]

    monkeypatch.setattr(_fancy, "supported", lambda *a, **k: True)
    monkeypatch.setattr(_fancy, "choose_one", fake_choose)
    title = "Resistors\n  Resistance  (on 12 products)"
    assert choose_one(ITEMS, render, title=title, prompt="  file as > ",
                      fuzzy=True) == "beta"
    assert seen["options"] == ITEMS
    assert seen["fuzzy"] is True
    assert "Resistance" in seen["context"]


def test_confirm_uses_the_fancy_version_when_the_terminal_allows(monkeypatch):
    monkeypatch.setattr(_fancy, "supported", lambda *a, **k: True)
    monkeypatch.setattr(_fancy, "confirm", lambda q, *, default: True)
    assert confirm("Map them now?", default=False) is True


def test_confirm_skip_takes_the_default(monkeypatch):
    monkeypatch.setattr(_fancy, "supported", lambda *a, **k: True)
    monkeypatch.setattr(_fancy, "confirm", lambda q, *, default: None)
    assert confirm("Map them now?", default=True) is True


# --------------------------------------------------------------------------
# _fancy.supported
# --------------------------------------------------------------------------
class _FakeStream:
    def __init__(self, tty: bool):
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty

    def fileno(self) -> int:
        return 0


def test_fancy_needs_a_terminal_at_both_ends(monkeypatch):
    monkeypatch.setenv("TERM", "xterm-256color")
    monkeypatch.delenv(keys.PLAIN_ENV_VAR, raising=False)
    assert _fancy.supported(_FakeStream(True), _FakeStream(True)) is True
    assert _fancy.supported(_FakeStream(True), _FakeStream(False)) is False
    assert _fancy.supported(_FakeStream(False), _FakeStream(True)) is False


def test_fancy_rejects_a_dumb_terminal(monkeypatch):
    monkeypatch.delenv(keys.PLAIN_ENV_VAR, raising=False)
    monkeypatch.setenv("TERM", "dumb")
    assert _fancy.supported(_FakeStream(True), _FakeStream(True)) is False


def test_fancy_respects_the_plain_override(monkeypatch):
    monkeypatch.setenv("TERM", "xterm-256color")
    monkeypatch.setenv(keys.PLAIN_ENV_VAR, "1")
    assert _fancy.supported(_FakeStream(True), _FakeStream(True)) is False


# --------------------------------------------------------------------------
# choose_one
# --------------------------------------------------------------------------
def test_choose_one_returns_the_option(answers):
    answers("2")
    assert choose_one(ITEMS, render, title="t") == "beta"


def test_choose_one_reprompts_on_a_bad_answer(answers, capsys):
    answers("9", "1")
    assert choose_one(ITEMS, render, title="t") == "alpha"
    assert "not one of 1-4" in capsys.readouterr().out


def test_choose_one_can_be_cancelled(answers):
    answers("q")
    assert choose_one(ITEMS, render, title="t") is None


def test_choose_one_with_no_options_is_a_cancel():
    assert choose_one([], render, title="t") is None


# --------------------------------------------------------------------------
# choose_row / Menu (folder browser)
# --------------------------------------------------------------------------
def drive_menu(keypresses, items=ITEMS, size=(80, 24), help=""):
    menu = Menu(items, render, "t", help=help)
    pressed = iter(keypresses)
    frames: list[str] = []
    result = run_menu_cursor(menu, lambda: next(pressed, keys.CANCEL),
                             frames.append, lambda: size)
    return result, frames


def test_choose_row_a_number_submits_that_row(answers):
    answers("2")
    assert choose_row(ITEMS, render, title="t") == ("beta", keys.SUBMIT)


def test_choose_row_can_open_select_create_and_go_back(answers):
    answers("o 1")
    assert choose_row(ITEMS, render, title="t") == ("alpha", keys.RIGHT)
    answers("s 3")
    assert choose_row(ITEMS, render, title="t") == ("gamma", keys.TOGGLE)
    answers("c")
    assert choose_row(ITEMS, render, title="t") == ("__create__", keys.SUBMIT)
    answers("b")
    assert choose_row(ITEMS, render, title="t") == (None, keys.LEFT)


def test_choose_row_can_be_cancelled(answers):
    answers("q")
    assert choose_row(ITEMS, render, title="t") is None


def test_menu_enter_submits_the_highlighted_row():
    result, _ = drive_menu([keys.DOWN, keys.SUBMIT])
    assert result == ("beta", keys.SUBMIT)


def test_menu_space_selects_without_opening():
    result, _ = drive_menu([keys.TOGGLE])
    assert result == ("alpha", keys.TOGGLE)


def test_menu_arrows_open_and_go_back():
    assert drive_menu([keys.RIGHT])[0] == ("alpha", keys.RIGHT)
    assert drive_menu([keys.LEFT])[0] == (None, keys.LEFT)


def test_menu_frame_highlights_the_cursor_and_shows_help():
    menu = Menu(ITEMS, render, "t", help="UP/DOWN move")
    lines = menu_frame(menu, 80, 24)
    assert "> alpha" in visible(lines[1])
    assert "  beta" in visible(lines[2])
    assert any("UP/DOWN move" in line for line in lines)
    assert lines[1].startswith("\x1b[7m")


# --------------------------------------------------------------------------
# confirm
# --------------------------------------------------------------------------
@pytest.mark.parametrize("typed,default,expected", [
    ("y", False, True),
    ("yes", False, True),
    ("n", True, False),
    ("", True, True),                    # bare ENTER takes the default
    ("", False, False),
    ("nonsense", True, False),
])
def test_confirm(answers, typed, default, expected):
    answers(typed)
    assert confirm("go?", default=default) is expected


def test_confirm_on_eof_takes_the_default(answers):
    assert confirm("go?", default=True) is True


# --------------------------------------------------------------------------
# interactive
# --------------------------------------------------------------------------
def test_interactive_is_true_for_a_tty(answers):
    assert interactive() is True


def test_interactive_is_false_when_stdin_is_piped(monkeypatch):
    import io
    monkeypatch.setattr("sys.stdin", io.StringIO("piped"))
    assert interactive() is False

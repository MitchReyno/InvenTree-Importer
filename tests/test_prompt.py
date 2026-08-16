"""The interactive prompt primitives."""

from __future__ import annotations

import re

import pytest

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def visible(text: str) -> str:
    """What a row occupies on screen, with the escape codes taken out."""
    return ANSI.sub("", text)

from invimport.commands import _keys as keys
from invimport.commands._prompt import (
    Checklist,
    choose_one,
    confirm,
    frame,
    interactive,
    parse_selection,
    redraw,
    run_cursor,
    select_many,
)

ITEMS = ["alpha", "beta", "gamma", "delta"]


def render(item: str) -> str:
    return item


def checklist(items=ITEMS, **kw) -> Checklist:
    return Checklist(items, render, kw.pop("title", "t"), **kw)


def drive(keypresses, items=ITEMS, size=(80, 24), selected=True):
    """
    Run the cursor loop over a scripted list of keypresses.

    Returns (result, frames) - the frames being every escape-sequence write, so
    a test can assert on what was drawn as well as what came back.
    """
    lst = Checklist(items, render, "t", state=[selected] * len(items))
    pressed = iter(keypresses)
    frames: list[str] = []
    result = run_cursor(lst, lambda: next(pressed, keys.CANCEL),
                        frames.append, lambda: size)
    return result, frames


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
# select_many: cursor version
# --------------------------------------------------------------------------
def test_space_toggles_the_row_under_the_cursor():
    result, _ = drive([keys.TOGGLE, keys.SUBMIT])
    assert result == ["beta", "gamma", "delta"]


def test_arrows_move_the_cursor_before_toggling():
    result, _ = drive([keys.DOWN, keys.DOWN, keys.TOGGLE, keys.SUBMIT])
    assert result == ["alpha", "beta", "delta"]


def test_the_cursor_stops_at_the_top():
    """Holding up past the first row must not wrap round to the bottom."""
    result, _ = drive([keys.UP, keys.UP, keys.UP, keys.TOGGLE, keys.SUBMIT])
    assert result == ["beta", "gamma", "delta"]


def test_the_cursor_stops_at_the_bottom():
    result, _ = drive([keys.BOTTOM, keys.DOWN, keys.DOWN, keys.TOGGLE,
                       keys.SUBMIT])
    assert result == ["alpha", "beta", "gamma"]


def test_top_and_bottom_jump():
    result, _ = drive([keys.BOTTOM, keys.TOGGLE, keys.TOP, keys.TOGGLE,
                       keys.SUBMIT])
    assert result == ["beta", "gamma"]


def test_all_and_none_still_work_from_the_cursor_version():
    result, _ = drive([keys.NONE, keys.DOWN, keys.TOGGLE, keys.SUBMIT])
    assert result == ["beta"]


def test_cancel_returns_nothing():
    assert drive([keys.CANCEL])[0] is None


def test_running_out_of_keys_cancels():
    """A terminal that goes away mid-prompt backs out rather than looping."""
    assert drive([keys.DOWN])[0] is None


def test_unknown_keys_are_ignored():
    result, _ = drive([keys.UNKNOWN, keys.UNKNOWN, keys.TOGGLE, keys.SUBMIT])
    assert result == ["beta", "gamma", "delta"]


def test_submitting_nothing_is_refused_and_says_so():
    result, frames = drive([keys.NONE, keys.SUBMIT, keys.TOGGLE, keys.SUBMIT])
    assert result == ["alpha"]
    assert "nothing selected" in "".join(frames)


def test_ctrl_c_during_a_redraw_cancels_cleanly():
    """KeyboardInterrupt must not escape into the command as a traceback."""
    lst = checklist()

    def boom():
        raise KeyboardInterrupt

    assert run_cursor(lst, boom, lambda _: None, lambda: (80, 24)) is None


# --------------------------------------------------------------------------
# Frame rendering
# --------------------------------------------------------------------------
def test_the_frame_marks_the_cursor_and_the_ticks():
    lines = frame(checklist(), 80, 24)
    assert lines[0] == "t"
    assert "> [x] alpha" in lines[1]
    assert lines[2] == "    [x] beta"
    assert "  4 of 4 selected" in lines
    assert any("SPACE toggle" in line for line in lines)


def test_the_cursor_row_is_highlighted():
    lines = frame(checklist(), 80, 24)
    assert lines[1].startswith("\x1b[7m") and lines[1].endswith("\x1b[0m")
    assert "\x1b[7m" not in lines[2]


def test_the_final_frame_drops_the_cursor_and_the_help():
    lines = frame(checklist(), 80, 24, final=True)
    assert not any("\x1b[7m" in line for line in lines)
    assert not any("SPACE toggle" in line for line in lines)
    assert "  4 of 4 selected" in lines


def test_long_rows_are_cut_to_the_terminal_width():
    """
    Wrapping would desync the redraw, which counts lines to move back up.
    Measured without the escape codes: they take no space on screen.
    """
    lines = frame(checklist(["x" * 200]), 40, 24)
    assert all(len(visible(line)) < 40 for line in lines)


def test_a_long_list_scrolls_instead_of_overflowing():
    items = [f"item {n}" for n in range(50)]
    lines = frame(checklist(items), 80, 24)
    assert len(lines) <= 24
    assert any("more below" in line for line in lines)


def test_scrolling_follows_the_cursor_down_the_list():
    items = [f"item {n}" for n in range(50)]
    lst = checklist(items)
    lst.cursor = 40
    text = "\n".join(frame(lst, 80, 24))
    assert "item 40" in text
    assert "item 0" not in text
    assert "more above" in text


def test_a_short_list_needs_no_scroll_markers():
    text = "\n".join(frame(checklist(), 80, 24))
    assert "more below" not in text and "more above" not in text


def test_a_tiny_terminal_still_renders_some_rows():
    lines = frame(checklist(), 80, 4)
    assert any("alpha" in line for line in lines)


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
    monkeypatch.setattr(keys, "supported", lambda *a, **k: True)
    answers("")
    assert select_many(ITEMS, render, title="t", plain=True) == ITEMS
    assert "toggle: numbers or ranges" in capsys.readouterr().out


def test_the_cursor_version_is_used_when_the_terminal_allows(monkeypatch):
    seen = {}
    monkeypatch.setattr(keys, "supported", lambda *a, **k: True)
    monkeypatch.setattr("invimport.commands._prompt.select_cursor",
                        lambda lst: seen.setdefault("items", list(lst.items)))
    select_many(ITEMS, render, title="t")
    assert seen["items"] == ITEMS


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

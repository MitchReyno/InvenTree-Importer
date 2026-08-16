"""
Interactive prompts shared by the CLI commands.

The checklist comes in two forms over one state machine:

    cursor   arrow keys move, SPACE toggles, ENTER submits. Needs a terminal
             on both stdin and stdout, and puts it into raw mode to do it.
    plain    a numbered list; type numbers or ranges to toggle, ENTER submits.
             Works anywhere - over a pipe, in a dumb terminal, under pytest.

select_many() picks whichever the terminal can support, so the caller never
has to care. Neither needs a dependency beyond the standard library.

Every prompt returns None when the user backs out (q, ESC, Ctrl-C or EOF) so
callers can treat "cancelled" as an ordinary outcome rather than an exception.

Only the CLI layer prompts. Library code takes its answers as arguments.
"""

from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from . import _keys as keys

CANCELLED = None

# Drawn below the list; kept short enough to survive a narrow terminal.
CURSOR_HELP = ("UP/DOWN move   SPACE toggle   a all   n none   "
               "ENTER {verb}   q cancel")
PLAIN_HELP = ("toggle: numbers or ranges (e.g. 1 3-5)   a=all   n=none   "
              "q=cancel")

# Rows the frame needs for its title, spacing, count and help.
CHROME_ROWS = 5
MIN_VISIBLE_ROWS = 3


def interactive() -> bool:
    """Is there a human on the other end? Piped stdin means no."""
    try:
        return sys.stdin.isatty()
    except (AttributeError, ValueError):
        return False


def ask(prompt: str) -> str | None:
    """Read one line. None on EOF or Ctrl-C, so prompts can be backed out of."""
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return CANCELLED


def parse_selection(text: str, count: int) -> tuple[set[int], list[str]]:
    """
    Parse "1 3-5, 8" into zero-based indexes, plus whatever made no sense.

    Ranges are inclusive and may be given backwards. Out-of-range numbers are
    reported rather than silently dropped - a typo that quietly selects nothing
    is worse than one that says so.
    """
    chosen: set[int] = set()
    bad: list[str] = []

    for token in text.replace(",", " ").split():
        if "-" in token[1:]:
            low, _, high = token.partition("-")
            bounds = []
            for part in (low, high):
                if not part.strip().isdigit():
                    bad.append(token)
                    break
                bounds.append(int(part))
            else:
                start, end = sorted(bounds)
                valid = [n for n in range(start, end + 1) if 1 <= n <= count]
                if not valid:
                    bad.append(token)
                chosen.update(n - 1 for n in valid)
        elif token.isdigit() and 1 <= int(token) <= count:
            chosen.add(int(token) - 1)
        else:
            bad.append(token)

    return chosen, bad


# --------------------------------------------------------------------------
# Shared state
# --------------------------------------------------------------------------
@dataclass
class Checklist:
    """
    What is in the list, what is ticked, and where the cursor is.

    Deliberately knows nothing about terminals: both front-ends drive this,
    and it can be exercised key by key in a test without a tty.
    """
    items: Sequence[Any]
    render: Callable[[Any], str]
    title: str
    verb: str = "continue"
    state: list[bool] = field(default_factory=list)
    cursor: int = 0
    offset: int = 0
    message: str = ""

    def __post_init__(self) -> None:
        if not self.state:
            self.state = [True] * len(self.items)

    # -- selection ---------------------------------------------------------
    @property
    def count(self) -> int:
        return sum(self.state)

    def chosen(self) -> list[Any]:
        return [item for item, on in zip(self.items, self.state) if on]

    def toggle(self, index: int) -> None:
        self.state[index] = not self.state[index]

    def set_all(self, value: bool) -> None:
        self.state = [value] * len(self.items)

    # -- cursor ------------------------------------------------------------
    def move(self, delta: int) -> None:
        self.cursor = max(0, min(len(self.items) - 1, self.cursor + delta))

    def handle(self, key: str) -> str | None:
        """Apply one keypress. Returns SUBMIT, CANCEL, or None to carry on."""
        self.message = ""

        if key == keys.UP:
            self.move(-1)
        elif key == keys.DOWN:
            self.move(1)
        elif key == keys.TOP:
            self.cursor = 0
        elif key == keys.BOTTOM:
            self.cursor = len(self.items) - 1
        elif key == keys.PAGE_UP:
            self.move(-10)
        elif key == keys.PAGE_DOWN:
            self.move(10)
        elif key == keys.TOGGLE:
            self.toggle(self.cursor)
        elif key == keys.ALL:
            self.set_all(True)
        elif key == keys.NONE:
            self.set_all(False)
        elif key == keys.CANCEL:
            return keys.CANCEL
        elif key == keys.SUBMIT:
            if not self.count:
                self.message = ("nothing selected - press SPACE to pick at "
                                "least one, or q to cancel")
                return None
            return keys.SUBMIT
        return None

    # -- viewport ----------------------------------------------------------
    def scroll(self, visible: int) -> None:
        """Keep the cursor inside the window, moving the window as little as
        possible so the list does not jump about under the user."""
        if self.cursor < self.offset:
            self.offset = self.cursor
        elif self.cursor >= self.offset + visible:
            self.offset = self.cursor - visible + 1
        self.offset = max(0, min(self.offset, max(0, len(self.items) - visible)))


# --------------------------------------------------------------------------
# Cursor front-end
# --------------------------------------------------------------------------
def frame(checklist: Checklist, width: int, height: int,
          final: bool = False) -> list[str]:
    """
    Render one frame as a list of lines, each already cut to the terminal
    width. Wrapping would break the redraw, which counts lines to move back up.
    """
    body = max(MIN_VISIBLE_ROWS, height - CHROME_ROWS)
    scrolling = len(checklist.items) > body
    visible = body - 1 if scrolling else body
    checklist.scroll(visible)

    def cut(text: str) -> str:
        return text[:max(1, width - 1)]

    lines = [cut(checklist.title)]

    window = range(checklist.offset,
                   min(checklist.offset + visible, len(checklist.items)))
    for index in window:
        mark = "x" if checklist.state[index] else " "
        here = index == checklist.cursor and not final
        row = cut(f"  {'>' if here else ' '} [{mark}] "
                  f"{checklist.render(checklist.items[index])}")
        # Reverse video for the cursor row: applied after the cut so the escape
        # codes cannot be sliced in half.
        lines.append(f"\x1b[7m{row}\x1b[0m" if here else row)

    if scrolling:
        above = checklist.offset
        below = len(checklist.items) - (checklist.offset + visible)
        marker = "   ".join(
            part for part in (f"  {above} more above" if above else "",
                              f"{below} more below" if below else "") if part)
        lines.append(cut(marker or "  "))

    lines.append("")
    lines.append(cut(f"  {checklist.count} of {len(checklist.items)} selected"))
    if not final:
        lines.append(cut("  " + CURSOR_HELP.format(verb=checklist.verb)))
        if checklist.message:
            lines.append(cut(f"  {checklist.message}"))
    return lines


def redraw(lines: list[str], previous: int) -> str:
    """
    The escape sequence that replaces the previous frame with this one.

    Move back up over what was drawn, then rewrite every line, clearing each
    first. Any rows the last frame used and this one does not are blanked, so a
    list that shrinks leaves nothing behind.
    """
    out: list[str] = []
    if previous:
        out.append(f"\x1b[{previous}A")
    for line in lines:
        out.append(f"\x1b[2K{line}\n")

    extra = max(0, previous - len(lines))
    for _ in range(extra):
        out.append("\x1b[2K\n")
    if extra:
        out.append(f"\x1b[{extra}A")
    return "".join(out)


def run_cursor(checklist: Checklist, read: Callable[[], str],
               write: Callable[[str], None],
               size: Callable[[], tuple[int, int]]) -> list[Any] | None:
    """
    The draw/read/apply loop.

    read, write and size are injected so the loop can be driven by a scripted
    list of keypresses in a test - the terminal handling around it is what
    select_cursor() adds.
    """
    previous = 0
    try:
        while True:
            width, height = size()
            lines = frame(checklist, width, height)
            write(redraw(lines, previous))
            previous = len(lines)

            outcome = checklist.handle(read())
            if outcome is None:
                continue

            # Redraw one last time without the cursor or the help, leaving the
            # final state of the list on screen as a record of what was picked.
            width, height = size()
            write(redraw(frame(checklist, width, height, final=True), previous))
            return checklist.chosen() if outcome == keys.SUBMIT else CANCELLED
    except KeyboardInterrupt:
        write("\n")
        return CANCELLED


def terminal_size() -> tuple[int, int]:
    size = shutil.get_terminal_size(fallback=(80, 24))
    return size.columns, size.lines


def select_cursor(checklist: Checklist) -> list[Any] | None:
    """Drive the checklist with the real terminal in raw mode."""
    reader = keys.StdinReader()
    write = sys.stdout.write

    def flushing(text: str) -> None:
        write(text)
        sys.stdout.flush()

    with keys.raw_mode(reader.fd):
        flushing("\x1b[?25l")                     # hide the cursor
        try:
            return run_cursor(checklist, lambda: keys.read_key(reader),
                              flushing, terminal_size)
        finally:
            flushing("\x1b[?25h")                 # and always put it back


# --------------------------------------------------------------------------
# Plain front-end
# --------------------------------------------------------------------------
def select_plain(checklist: Checklist) -> list[Any] | None:
    """Numbered list, one line of input at a time. Works over a pipe."""
    width = len(str(len(checklist.items)))

    while True:
        print(f"\n{checklist.title}")
        for index, item in enumerate(checklist.items, start=1):
            mark = "x" if checklist.state[index - 1] else " "
            print(f"  {index:>{width}} [{mark}] {checklist.render(item)}")

        print(f"\n  {checklist.count} of {len(checklist.items)} selected")
        print(f"  {PLAIN_HELP}")
        if checklist.message:
            print(f"  {checklist.message}")

        answer = ask(f"  ENTER to {checklist.verb} > ")
        if answer is None or answer.lower() == "q":
            return CANCELLED

        checklist.message = ""
        if answer == "":
            if not checklist.count:
                checklist.message = ("nothing selected - pick at least one, "
                                     "or q to cancel")
                continue
            return checklist.chosen()
        if answer.lower() == "a":
            checklist.set_all(True)
            continue
        if answer.lower() == "n":
            checklist.set_all(False)
            continue

        chosen, bad = parse_selection(answer, len(checklist.items))
        for index in chosen:
            checklist.toggle(index)
        if bad:
            checklist.message = f"ignored: {' '.join(bad)}"


# --------------------------------------------------------------------------
# Public prompts
# --------------------------------------------------------------------------
def select_many(
    items: Sequence[Any],
    render: Callable[[Any], str],
    *,
    title: str,
    verb: str = "continue",
    selected: bool = True,
    plain: bool = False,
) -> list[Any] | None:
    """
    Toggle a checklist, then submit it.

    Uses arrow keys and SPACE when the terminal allows, and a numbered list
    when it does not. Returns the chosen items in list order, or None if the
    user quit.
    """
    if not items:
        return []

    checklist = Checklist(items, render, title, verb,
                          state=[selected] * len(items))
    if not plain and keys.supported():
        return select_cursor(checklist)
    return select_plain(checklist)


def choose_one(
    options: Sequence[Any],
    render: Callable[[Any], str],
    *,
    title: str,
    prompt: str = "  choose > ",
) -> Any | None:
    """Pick exactly one option. Returns the option, or None if cancelled."""
    if not options:
        return CANCELLED

    while True:
        print(f"\n{title}")
        width = len(str(len(options)))
        for index, option in enumerate(options, start=1):
            print(f"  {index:>{width}}) {render(option)}")
        print(f"  {'q':>{width}}) cancel")

        answer = ask(prompt)
        if answer is None or answer.lower() == "q":
            return CANCELLED
        if answer.isdigit() and 1 <= int(answer) <= len(options):
            return options[int(answer) - 1]
        print(f"  '{answer}' is not one of 1-{len(options)}")


def confirm(question: str, *, default: bool = False) -> bool:
    """Yes/no. EOF or Ctrl-C answers with the default rather than hanging."""
    suffix = "[Y/n]" if default else "[y/N]"
    answer = ask(f"{question} {suffix} ")
    if answer is None or answer == "":
        return default
    return answer.lower() in ("y", "yes")

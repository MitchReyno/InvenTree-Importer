"""
Interactive prompts shared by the CLI commands.

Two front-ends over one façade:

    fancy    InquirerPy menus, fuzzy search on long lists, Rich chrome.
             Used when stdin and stdout are a real terminal.
    plain    a numbered list; type a number, or numbers/ranges to toggle.
             Works anywhere - over a pipe, in a dumb terminal, under pytest.

The category folder browser (choose_row) is still a custom cursor widget:
InquirerPy has no equivalent for ENTER-vs-SPACE-vs-arrow on one row.

Every prompt returns None when the user backs out (q, ESC, Ctrl-C or EOF) so
callers can treat "cancelled" as an ordinary outcome rather than an exception.

Only the CLI layer prompts. Library code takes its answers as arguments.
"""

from __future__ import annotations

import re
import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from . import _fancy
from . import _keys as keys

console = _fancy.console

_PROMPT_TAIL = re.compile(r"[\s>]+$")

CANCELLED = None

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


def question_and_context(title: str, prompt: str = "") -> tuple[str, str]:
    """
    Split a title into the InquirerPy question and optional Rich chrome.

    A single line is the question. Several lines are context (shown in a
    panel) plus a short question taken from `prompt`, so the sample values
    sit above the menu instead of being crammed into it.
    """
    lines = title.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    question = _PROMPT_TAIL.sub("", prompt.strip())
    if len(lines) > 1:
        return (question or "choose", "\n".join(lines))
    heading = lines[0].strip() if lines else ""
    return (heading or question or "choose", "")


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
    What is in the list and what is ticked.

    The numbered fallback drives this; InquirerPy owns the TTY checklist.
    """
    items: Sequence[Any]
    render: Callable[[Any], str]
    title: str
    verb: str = "continue"
    state: list[bool] = field(default_factory=list)
    message: str = ""

    def __post_init__(self) -> None:
        if not self.state:
            self.state = [True] * len(self.items)

    @property
    def count(self) -> int:
        return sum(self.state)

    def chosen(self) -> list[Any]:
        return [item for item, on in zip(self.items, self.state) if on]

    def toggle(self, index: int) -> None:
        self.state[index] = not self.state[index]

    def set_all(self, value: bool) -> None:
        self.state = [value] * len(self.items)


@dataclass
class Menu:
    """
    A single-select list: the cursor is the choice.

    Same terminal-agnostic shape as Checklist, so the cursor and plain
    front-ends can both drive it, and tests can send keypresses without a tty.
    """
    items: Sequence[Any]
    render: Callable[[Any], str]
    title: str
    verb: str = "select"
    help: str = ""
    cursor: int = 0
    offset: int = 0
    message: str = ""

    def move(self, delta: int) -> None:
        if not self.items:
            return
        self.cursor = max(0, min(len(self.items) - 1, self.cursor + delta))

    def handle(self, key: str) -> str | None:
        """Apply one keypress. Returns SUBMIT, SELECT, RIGHT, LEFT, CANCEL, or None."""
        self.message = ""
        if key == keys.UP:
            self.move(-1)
        elif key == keys.DOWN:
            self.move(1)
        elif key == keys.TOP:
            self.cursor = 0
        elif key == keys.BOTTOM:
            self.cursor = max(0, len(self.items) - 1)
        elif key == keys.PAGE_UP:
            self.move(-10)
        elif key == keys.PAGE_DOWN:
            self.move(10)
        elif key == keys.SUBMIT:
            return keys.SUBMIT
        elif key == keys.TOGGLE:
            return keys.TOGGLE                   # SPACE: select this, do not open
        elif key == keys.RIGHT:
            return keys.RIGHT
        elif key == keys.LEFT:
            return keys.LEFT
        elif key == keys.CANCEL:
            return keys.CANCEL
        return None

    def scroll(self, visible: int) -> None:
        if self.cursor < self.offset:
            self.offset = self.cursor
        elif self.cursor >= self.offset + visible:
            self.offset = self.cursor - visible + 1
        self.offset = max(0, min(self.offset, max(0, len(self.items) - visible)))

    def current(self) -> Any | None:
        if not self.items:
            return None
        return self.items[self.cursor]


# --------------------------------------------------------------------------
# Folder-browser cursor front-end
# --------------------------------------------------------------------------
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


def terminal_size() -> tuple[int, int]:
    size = shutil.get_terminal_size(fallback=(80, 24))
    return size.columns, size.lines


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

    InquirerPy checkboxes when the terminal allows, a numbered list when it
    does not. Returns the chosen items in list order, or None if the user quit.
    """
    if not items:
        return []

    if not plain and _fancy.supported():
        message, context = question_and_context(title)
        return _fancy.select_many(
            items, render, message=message, verb=verb, selected=selected,
            context=context)

    checklist = Checklist(items, render, title, verb,
                          state=[selected] * len(items))
    return select_plain(checklist)


MENU_HELP = "UP/DOWN move   ENTER {verb}   q cancel"
# Browser: ENTER opens a folder or picks a leaf; SPACE picks the row as-is.
BROWSER_HELP = ("UP/DOWN move   ENTER open/select   → open   ← back   "
                "SPACE select this   q skip")
PLAIN_MENU_HELP = "number=open/select   o N=open   s N=select this   c=create   b=back   q=skip"


def menu_frame(menu: Menu, width: int, height: int,
               final: bool = False) -> list[str]:
    """One frame of a single-select menu, already cut to the terminal width."""
    title_lines = menu.title.splitlines() or [""]
    body = max(MIN_VISIBLE_ROWS,
               height - CHROME_ROWS - (len(title_lines) - 1))
    scrolling = len(menu.items) > body
    visible = body - 1 if scrolling else body
    menu.scroll(visible)

    def cut(text: str) -> str:
        return text[:max(1, width - 1)]

    lines = [cut(line) for line in title_lines]
    window = range(menu.offset, min(menu.offset + visible, len(menu.items)))
    for index in window:
        here = index == menu.cursor and not final
        row = cut(f"  {'>' if here else ' '} {menu.render(menu.items[index])}")
        lines.append(f"\x1b[7m{row}\x1b[0m" if here else row)

    if scrolling:
        above = menu.offset
        below = len(menu.items) - (menu.offset + visible)
        marker = "   ".join(
            part for part in (f"  {above} more above" if above else "",
                              f"{below} more below" if below else "") if part)
        lines.append(cut(marker or "  "))

    if not final:
        lines.append("")
        help_text = menu.help or MENU_HELP.format(verb=menu.verb)
        lines.append(cut("  " + help_text))
        if menu.message:
            lines.append(cut(f"  {menu.message}"))
    return lines


def run_menu_cursor(menu: Menu, read: Callable[[], str],
                    write: Callable[[str], None],
                    size: Callable[[], tuple[int, int]]
                    ) -> tuple[Any | None, str] | None:
    """
    Draw/read/apply for a single-select menu.

    Returns (item, action) where action is SUBMIT, TOGGLE, RIGHT or LEFT, or
    None if the user cancelled. LEFT returns (None, LEFT) so a browser can
    go up a level.
    """
    previous = 0
    try:
        while True:
            width, height = size()
            lines = menu_frame(menu, width, height)
            write(redraw(lines, previous))
            previous = len(lines)

            outcome = menu.handle(read())
            if outcome is None:
                continue

            width, height = size()
            write(redraw(menu_frame(menu, width, height, final=True), previous))
            if outcome == keys.CANCEL:
                return None
            if outcome == keys.LEFT:
                return (None, keys.LEFT)
            return (menu.current(), outcome)
    except KeyboardInterrupt:
        write("\n")
        return None


def select_menu_cursor(menu: Menu) -> tuple[Any | None, str] | None:
    reader = keys.StdinReader()
    write = sys.stdout.write

    def flushing(text: str) -> None:
        write(text)
        sys.stdout.flush()

    with keys.raw_mode(reader.fd):
        flushing("\x1b[?25l")
        try:
            return run_menu_cursor(menu, lambda: keys.read_key(reader),
                                   flushing, terminal_size)
        finally:
            flushing("\x1b[?25h")


def choose_one_plain(
    options: Sequence[Any],
    render: Callable[[Any], str],
    *,
    title: str,
    prompt: str = "  choose > ",
    browser: bool = False,
) -> tuple[Any | None, str] | None:
    """
    Numbered list. Returns (item, action) or None if cancelled.

    In browser mode, extra verbs: o N opens, s N selects, c creates, b goes
    back. A bare number opens a folder or selects a leaf - the caller decides
    from the item.
    """
    if not options:
        return None

    while True:
        print(f"\n{title}")
        width = len(str(len(options)))
        for index, option in enumerate(options, start=1):
            print(f"  {index:>{width}}) {render(option)}")
        if browser:
            print(f"  {'b':>{width}}) back")
        print(f"  {'q':>{width}}) cancel")
        if browser:
            print(f"  {PLAIN_MENU_HELP}")

        answer = ask(prompt)
        if answer is None or answer.lower() == "q":
            return None
        if browser and answer.lower() == "b":
            return (None, keys.LEFT)
        if browser and answer.lower() == "c":
            return ("__create__", keys.SUBMIT)

        action = keys.SUBMIT
        token = answer
        if browser and len(answer) >= 2 and answer[0] in "osOS" and (
                answer[1] == " " or answer[1:].isdigit()):
            action = keys.RIGHT if answer[0] in "oO" else keys.TOGGLE
            token = answer[1:].strip()

        if token.isdigit() and 1 <= int(token) <= len(options):
            return (options[int(token) - 1], action)
        print(f"  '{answer}' is not one of 1-{len(options)}")


def choose_one(
    options: Sequence[Any],
    render: Callable[[Any], str],
    *,
    title: str,
    prompt: str = "  choose > ",
    plain: bool = False,
    fuzzy: bool | None = None,
) -> Any | None:
    """
    Pick exactly one option.

    InquirerPy select, or fuzzy search when the list is long (or fuzzy=True).
    Numbered list when the terminal cannot support that.
    """
    if not options:
        return CANCELLED

    if not plain and _fancy.supported():
        message, context = question_and_context(title, prompt)
        return _fancy.choose_one(
            options, render, message=message, context=context, fuzzy=fuzzy)

    picked = choose_one_plain(options, render, title=title, prompt=prompt)
    if picked is None:
        return CANCELLED
    return picked[0]


def choose_row(
    options: Sequence[Any],
    render: Callable[[Any], str],
    *,
    title: str,
    prompt: str = "  choose > ",
    plain: bool = False,
) -> tuple[Any | None, str] | None:
    """
    Pick a row and say how. For a folder browser: ENTER, SPACE, →, ←.

    Returns (item, action) or None if cancelled. action is SUBMIT, TOGGLE
    (SPACE / s N), RIGHT (open) or LEFT (back).
    """
    if not options:
        return None

    if not plain and keys.supported():
        menu = Menu(options, render, title, help=BROWSER_HELP)
        return select_menu_cursor(menu)
    return choose_one_plain(options, render, title=title, prompt=prompt,
                            browser=True)


def confirm(question: str, *, default: bool = False) -> bool:
    """Yes/no. EOF, Ctrl-C or skip answers with the default rather than hanging."""
    if _fancy.supported():
        picked = _fancy.confirm(question, default=default)
        return default if picked is None else picked
    suffix = "[Y/n]" if default else "[y/N]"
    answer = ask(f"{question} {suffix} ")
    if answer is None or answer == "":
        return default
    return answer.lower() in ("y", "yes")

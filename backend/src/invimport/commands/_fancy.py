"""
InquirerPy + Rich implementations of the interactive prompts.

_prompt.py is the façade: callers never import this. When stdin and stdout
are a real terminal, choose_one / select_many / confirm land here. A pipe,
a dumb TERM, or INVIMPORT_PLAIN_PROMPT keeps the numbered fallback, which is
how the test suite scripts answers without driving prompt_toolkit.

Cancel is skip, not an exception: ESC (and q, except while fuzzy-filtering)
returns None, matching the plain prompts.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Callable, Sequence

from InquirerPy import inquirer
from InquirerPy.base.control import Choice
from rich.console import Console
from rich.panel import Panel

from . import _keys as keys

# Long lists get a search box; short ones stay a visible menu.
FUZZY_AFTER = 12

console = Console(highlight=False, emoji=False)

# Shared: ctrl-c / ESC skip rather than raising, so the façade can return None.
_SKIP = dict(raise_keyboard_interrupt=False, mandatory=False)
_SKIP_SELECT = {
    "skip": [{"key": "escape"}, {"key": "q"}, {"key": "c-c"}],
    "up": [{"key": "up"}, {"key": "k"}, {"key": "c-p"}],
    "down": [{"key": "down"}, {"key": "j"}, {"key": "c-n"}],
}
_SKIP_FUZZY = {
    "skip": [{"key": "escape"}, {"key": "c-c"}],
}
_SKIP_CHECKBOX = {
    **_SKIP_SELECT,
    "toggle-all-true": [{"key": "a"}, {"key": "c-a"}, {"key": "alt-a"}],
    "toggle-all-false": [{"key": "n"}],
}


def supported(stdin=None, stdout=None) -> bool:
    """
    Can InquirerPy take over the terminal?

    Unlike the raw-mode category browser this does not need POSIX termios, so
    Windows gets the same menus. A pipe, a dumb TERM, or INVIMPORT_PLAIN_PROMPT
    still force the numbered fallback.
    """
    if os.environ.get(keys.PLAIN_ENV_VAR, "").strip() not in ("", "0", "false"):
        return False
    if os.environ.get("TERM", "").lower() == "dumb":
        return False
    for stream in (stdin or sys.stdin, stdout or sys.stdout):
        try:
            if not stream.isatty():
                return False
            stream.fileno()
        except (AttributeError, ValueError, OSError):
            return False
    return True


def show_context(text: str) -> None:
    """A panel above the prompt: category, sample values, why we are asking."""
    lines = text.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return
    if len(lines) == 1:
        body, title = lines[0].strip(), None
    else:
        title, body = lines[0].strip(), "\n".join(lines[1:]).rstrip()
    console.print(Panel(body, title=title, border_style="dim", padding=(0, 1)))


def _run(prompt) -> Any:
    try:
        return prompt.execute()
    except KeyboardInterrupt:
        return None


def _choices(items: Sequence[Any], render: Callable[[Any], str],
             *, enabled: bool | None = None) -> list[Choice]:
    rows = []
    for item in items:
        rows.append(Choice(
            value=item, name=render(item),
            enabled=False if enabled is None else enabled))
    return rows


def choose_one(
    options: Sequence[Any],
    render: Callable[[Any], str],
    *,
    message: str,
    context: str = "",
    fuzzy: bool | None = None,
) -> Any | None:
    if context:
        show_context(context)
    use_fuzzy = len(options) >= FUZZY_AFTER if fuzzy is None else fuzzy
    choices = _choices(options, render)
    if use_fuzzy:
        return _run(inquirer.fuzzy(
            message=message,
            choices=choices,
            instruction="(type to filter)",
            long_instruction="ENTER select   ESC cancel",
            border=True,
            max_height="70%",
            keybindings=_SKIP_FUZZY,
            **_SKIP,
        ))
    return _run(inquirer.select(
        message=message,
        choices=choices,
        long_instruction="UP/DOWN move   ENTER select   q cancel",
        max_height="70%",
        keybindings=_SKIP_SELECT,
        **_SKIP,
    ))


def select_many(
    items: Sequence[Any],
    render: Callable[[Any], str],
    *,
    message: str,
    verb: str = "continue",
    selected: bool = True,
    context: str = "",
) -> list[Any] | None:
    if context:
        show_context(context)
    result = _run(inquirer.checkbox(
        message=message,
        choices=_choices(items, render, enabled=selected),
        long_instruction=(
            f"SPACE toggle   a all   n none   ENTER {verb}   q cancel"),
        transformer=lambda picked: f"{len(picked)} selected",
        validate=lambda picked: bool(picked),
        invalid_message="nothing selected - pick at least one, or q to cancel",
        max_height="70%",
        keybindings=_SKIP_CHECKBOX,
        **_SKIP,
    ))
    return result


def confirm(question: str, *, default: bool = False) -> bool | None:
    """None if skipped, so the façade can substitute the default."""
    return _run(inquirer.confirm(
        message=question.strip(),
        default=default,
        **_SKIP,
    ))

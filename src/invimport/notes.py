"""
Notes for parts, manufacturer parts and stock, written as Markdown.

    from invimport.notes import PART_SECTIONS, render

    render({"summary": ["Dual D flip-flop"], "cautions": ["Not the 4013A"]},
           PART_SECTIONS)

InvenTree keeps a Markdown `notes` field on all three records, and each holds
a different kind of fact. Mixing them is what made the old notes unreadable: a
3 KB block of datasheet research repeated on every stock item of one part,
with the one sentence about this bag buried at the top.

- A part's notes are about the part in general: what it is, the figures the
  parameters cannot hold, NSNs and equivalents, look-alikes, the documents.
- A manufacturer part's notes are about one maker's number: what its suffix or
  grade means at that maker, a house or special number, how the maker was
  established (CAGE code, logo, catalogue).
- A stock item's notes are about this quantity: the count and how it was
  taken, the packaging and its seal, the markings exactly as printed.

A file gives each as named sections. Each section is Markdown text, or a list
rendered as bullets. `markings` is the exception: it is copied verbatim into a
code block, one printed line per line, because a label transcription must not
be reflowed or read as formatting. A plain string is still accepted and is
written as it stands.
"""

from __future__ import annotations

import re
from typing import Any

# (key in the file, heading in InvenTree), in the order they are rendered.
PART_SECTIONS = (
    ("summary", "Summary"),
    ("specifications", "Specifications"),
    ("cross_references", "Cross-references"),
    ("cautions", "Cautions"),
    ("references", "References"),
)
MANUFACTURER_PART_SECTIONS = (
    ("summary", "Summary"),
    ("identification", "Identification"),
    ("references", "References"),
)
STOCK_SECTIONS = (
    ("stock", "This stock"),
    ("markings", "Markings"),
    ("other", "Other"),
)

# Copied verbatim into a code block rather than rendered.
VERBATIM = {"markings"}

# Headed sections sit under the record's own "Notes" title in InvenTree, so
# they start at level 3: a level 1 or 2 heading shouts over the page.
HEADING = "###"

def parse(value: Any, sections: tuple[tuple[str, str], ...]
          ) -> tuple[str | dict[str, Any], list[str]]:
    """
    A notes value as the file wrote it, checked against its sections.

    Returns (notes, problems). Notes are a stripped string, or a mapping of
    section key to a string or a list of strings with blanks removed. Each
    problem is a sentence naming the section at fault.
    """
    if value in (None, ""):
        return "", []
    if isinstance(value, str):
        return value.strip(), []
    if not isinstance(value, dict):
        return "", [f"must be text, or a mapping of sections "
                    f"({', '.join(key for key, _ in sections)})"]

    known = [key for key, _ in sections]
    out: dict[str, Any] = {}
    problems: list[str] = []
    for key, body in value.items():
        if key not in known:
            problems.append(f"{key!r} is not a section here - use "
                            f"{', '.join(known)}")
            continue
        if body in (None, ""):
            continue
        if isinstance(body, str):
            if body.strip():
                out[key] = body.strip("\n")
        elif isinstance(body, list) and all(isinstance(item, str)
                                            for item in body):
            items = [item.strip() for item in body if item.strip()]
            if items:
                out[key] = items
        else:
            problems.append(f"section {key!r} must be text or a list of "
                            f"text")
    return out, problems


def render(notes: str | dict[str, Any],
           sections: tuple[tuple[str, str], ...],
           *, extra: list[tuple[str, list[str]]] | None = None) -> str:
    """
    Markdown for one record's notes.

    `extra` appends further headed sections the importer writes itself (the
    stock item's source), after the file's own.
    """
    blocks: list[str] = []
    if isinstance(notes, str):
        if notes.strip():
            blocks.append(notes.strip())
    else:
        for key, heading in sections:
            body = _body(key, notes.get(key))
            if body:
                blocks.append(f"{HEADING} {heading}\n\n{body}")
    for heading, items in extra or []:
        body = _bullets(items)
        if body:
            blocks.append(f"{HEADING} {heading}\n\n{body}")
    return "\n\n".join(blocks)


def stock_notes(notes: str | dict[str, Any], *, seller: str = "",
                approximate: bool = False, source_file: str = "") -> str:
    """
    A stock item's notes: the file's sections, then where it came from.

    An approximate quantity is a fact about this stock, so it leads that
    section; the seller and the import file form a Source section of their
    own, so they are never mixed in with what the file said.
    """
    if approximate:
        if isinstance(notes, str):
            lead = "Quantity is approximate."
            notes = f"{lead}\n\n{notes}" if notes.strip() else lead
        else:
            notes = dict(notes)
            stock = notes.get("stock")
            if isinstance(stock, list):
                notes["stock"] = ["Quantity is approximate", *stock]
            elif isinstance(stock, str):
                notes["stock"] = f"Quantity is approximate.\n\n{stock}"
            else:
                notes["stock"] = ["Quantity is approximate"]
    source = []
    if seller:
        source.append(f"Sold by {seller}")
    if source_file:
        source.append(f"Imported from `{source_file}`")
    return render(notes, STOCK_SECTIONS, extra=[("Source", source)])


def _body(key: str, value: Any) -> str:
    if not value:
        return ""
    if key in VERBATIM:
        text = "\n".join(value) if isinstance(value, list) else value
        return _code_block(text)
    if isinstance(value, list):
        return _bullets(value)
    return str(value).strip()


def _bullets(items: list[str]) -> str:
    """A Markdown list; a multi-line item stays inside its bullet."""
    lines = []
    for item in items:
        text = str(item).strip()
        if text:
            lines.append("- " + text.replace("\n", "\n  "))
    return "\n".join(lines)


def _code_block(text: str) -> str:
    """Fenced so that no run of backticks inside can close it early."""
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}\n{text.strip(chr(10))}\n{fence}"

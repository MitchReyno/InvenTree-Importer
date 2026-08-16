"""
Name matching: normalise, learned aliases, fuzzy candidates.

    from invimport.inventree.matching import match_name, candidates, match_path

    match_name("Yageo Corporation", ["YAGEO"])          # "YAGEO"
    match_path(["Resistors", "Through Hole Resistors"], categories)

Used for manufacturers and for category --learn. The library never prompts:
it returns what it knows and a list of candidates. The CLI asks, then writes
the answer back through config.add_alias().

Fuzzy results are only ever *offered*. The threshold decides what appears in
the menu, not what gets used - a wrongly merged manufacturer is tedious to
unpick, so a non-interactive run that cannot match exactly skips.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Iterable

from ..config import CategoryConfig

# Dropped after punctuation is stripped, so "Yageo Corporation" and "YAGEO"
# both become "yageo". The list is the usual corporate suffixes, not a guess
# at every legal form in the world.
SUFFIXES = frozenset({
    "inc", "incorporated", "corp", "corporation", "ltd", "limited",
    "gmbh", "co", "llc", "electronics", "ag", "sa", "pty", "plc",
})

PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
SPACE = re.compile(r"\s+")

# Offered in a menu, never applied on its own. High enough that "Vishay" and
# "Vishay Dale" appear together; low enough that unrelated names do not.
FUZZY_THRESHOLD = 0.6


def normalise(name: str) -> str:
    """
    Lower-case, strip punctuation, collapse whitespace, drop corporate suffixes.

    This alone resolves most real cases: "YAGEO" and "Yageo Corporation" both
    become "yageo".
    """
    text = PUNCT.sub(" ", name.casefold())
    words = [word for word in SPACE.split(text) if word and word not in SUFFIXES]
    return " ".join(words)


def match_name(name: str, existing: Iterable[str],
               aliases: dict[str, list[str]] | None = None) -> str | None:
    """
    The existing name that `name` already means, or None.

    Exact after normalisation first, then a learned alias. Does not fuzzy-
    match: that is candidates(), and only the caller may act on it.
    """
    want = normalise(name)
    if not want:
        return None

    existing = list(existing)
    for item in existing:
        if normalise(item) == want:
            return item

    for canonical, spellings in (aliases or {}).items():
        if want == normalise(canonical) or any(want == normalise(s)
                                               for s in spellings):
            for item in existing:
                if normalise(item) == normalise(canonical):
                    return item
            return canonical
    return None


def ratio(left: str, right: str) -> float:
    """Similarity of two names after normalisation, 0 to 1."""
    a, b = normalise(left), normalise(right)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def candidates(name: str, existing: Iterable[str],
               *, threshold: float = FUZZY_THRESHOLD,
               limit: int = 5) -> list[tuple[str, float]]:
    """
    Existing names similar to `name`, best first.

    Anything below the threshold is dropped. The caller offers these; it
    does not pick one.
    """
    scored = [(item, ratio(name, item)) for item in existing]
    scored = [(item, score) for item, score in scored if score >= threshold]
    scored.sort(key=lambda pair: (-pair[1], pair[0].casefold()))
    return scored[:limit]


def path_text(path: list[str] | str) -> str:
    """A DigiKey category path as the alias form: 'Resistors / Through Hole Resistors'."""
    if isinstance(path, str):
        return path
    return " / ".join(path)


def match_path(path: list[str] | str,
               categories: dict[str, CategoryConfig]) -> CategoryConfig | None:
    """
    The category whose alias is this DigiKey path.

    Aliases are full paths, matched exactly, longest first. An unmapped path
    returns None - a part in the wrong category is worse than a part not
    imported, so nothing is guessed here.
    """
    text = path_text(path)
    best: CategoryConfig | None = None
    best_len = -1
    for category in categories.values():
        for alias in category.aliases:
            if alias == text and len(alias) > best_len:
                best = category
                best_len = len(alias)
    return best


def unmapped_paths(paths: Iterable[list[str] | str],
                   categories: dict[str, CategoryConfig]) -> list[str]:
    """DigiKey paths that no category claims, sorted."""
    return sorted({path_text(path) for path in paths
                   if match_path(path, categories) is None and path_text(path)})


def manufacturer_aliases(manufacturers) -> dict[str, list[str]]:
    """{canonical name: aliases} from a loaded manufacturers config."""
    return {m.name: list(m.aliases) for m in manufacturers.values()}

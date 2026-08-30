"""
The stock-import skill must stay true as the config changes.

A skill is instructions an agent follows without checking them, so a stale
example is worse than no example: it produces a file that fails validation, and
the agent has no way to know the documentation was wrong rather than its own
reading. These tests read the skill and hold it to the real config.
"""

from __future__ import annotations

import json
import re

import pytest

from invimport.config import CONFIG_DIR, load_categories_config, load_parameters_config
from invimport.stockfile import CONDITIONS, LINE_KEYS, read_file
from invimport.validate import validate

SKILL = (CONFIG_DIR.parent / ".claude" / "skills" / "inventree-stock-import"
         / "SKILL.md")

pytestmark = pytest.mark.skipif(not SKILL.exists(), reason="skill not installed")


@pytest.fixture(scope="module")
def text() -> str:
    return SKILL.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def example(text) -> dict:
    """The full worked example: the first fenced JSON object in the skill."""
    block = re.search(r"```json\n(\{.*?\n\})\n```", text, re.S)
    assert block, "the skill should show a complete example file"
    return json.loads(block.group(1))


def test_the_skill_declares_a_name_and_a_description(text):
    front = re.match(r"---\n(.*?)\n---", text, re.S)
    assert front, "a skill needs YAML frontmatter"
    assert re.search(r"^name:\s*inventree-stock-import$", front.group(1), re.M)
    assert re.search(r"^description:\s*\S", front.group(1), re.M)


def test_the_worked_example_is_a_valid_stock_file(example, tmp_path):
    """The example an agent copies has to survive the reader."""
    path = tmp_path / "example.json"
    path.write_text(json.dumps(example))
    document = read_file(path)
    assert document.lines, "the example should contain at least one line"


def test_the_worked_example_passes_validation_against_the_real_config(
        example, tmp_path):
    """
    Clean, and warning-free.

    A warning would mean the example teaches a partial identity - exactly the
    case that makes a real import stop and ask a human.
    """
    path = tmp_path / "example.json"
    path.write_text(json.dumps(example))
    report = validate(read_file(path), load_categories_config(),
                      load_parameters_config())
    assert report.ok, report.text()
    assert report.warnings == [], report.text()


def test_the_example_only_uses_fields_the_reader_accepts(example):
    for line in example["lines"]:
        unknown = set(line) - LINE_KEYS
        assert not unknown, f"example line uses unknown field(s): {unknown}"


# Category paths the skill names *because they do not exist* - the counter-
# examples that teach an agent what going wrong looks like. Listed here rather
# than sniffed out of the prose, because "the category is X, not Y" puts an
# endorsement and a counter-example on the same line.
COUNTER_EXAMPLES = frozenset({
    "Resistors/THT",                 # what an agent guesses instead of the real name
    "Resistors/SMD",                 # the did_you_mean example
    "Capacitors/Mica Capacitors",    # the suggest_category example
})


def _quoted_paths(text: str) -> set[str]:
    """Backticked things shaped like a category path."""
    found = set()
    for quoted in re.findall(r"`([A-Z][A-Za-z0-9 ,&()-]+/[A-Za-z0-9 ,&()-]+)`", text):
        if quoted.endswith((".json", ".md", ".yaml", ".csv")):
            continue
        found.add(quoted)
    return found


def test_every_category_the_skill_endorses_exists(text):
    """A path quoted in prose is one an agent will copy verbatim."""
    categories = load_categories_config()
    for path in _quoted_paths(text) - COUNTER_EXAMPLES:
        assert path in categories, (
            f"the skill names category {path!r}, which is not in the config - "
            f"add it to COUNTER_EXAMPLES if that is deliberate")


def test_the_counter_examples_are_still_wrong(text):
    """
    The other direction, and the one that rots silently.

    'not Resistors/SMD' stops being a useful warning the day someone adds a
    category by that name, and the skill would then be teaching an agent to
    avoid a path that works.
    """
    categories = load_categories_config()
    for path in COUNTER_EXAMPLES:
        assert path not in categories, (
            f"the skill warns against {path!r}, but it now exists - the "
            f"skill's advice is out of date")
    for path in COUNTER_EXAMPLES:
        assert path in text, (
            f"{path!r} is listed as a counter-example but the skill no longer "
            f"mentions it")


def test_the_conditions_the_skill_mentions_are_real(text):
    for quoted in re.findall(r'`"condition": "([a-z]+)"`', text):
        assert quoted in CONDITIONS, f"unknown condition {quoted!r} in the skill"


def test_the_skill_tells_the_agent_to_read_the_vocabulary_first(text):
    """Without it the agent guesses category and parameter names, and misses."""
    assert "--vocabulary" in text
    assert "--validate" in text


def test_the_skill_requires_consent_before_writing(text):
    """
    --write creates real inventory records.

    The skill has to say so unambiguously: an agent that writes because the
    dry run looked fine has skipped the only human check in the loop.
    """
    assert re.search(r"[Nn]ever run `--write` without", text)
    assert "--write" in text and "--validate" in text


def test_the_skill_warns_about_renumbering_ids(text):
    """
    Stable ids are what stop a re-import doubling the stock.

    It is also the mistake an agent is most likely to make unprompted, since
    regenerating a file from the same photo feels like a fresh start.
    """
    assert re.search(r"keep the ids you already used", text)


def test_the_skill_does_not_overclaim_what_ran(text):
    assert re.search(r"[Dd]o not claim stock was imported", text)

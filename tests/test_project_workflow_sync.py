"""Keep the Claude and Codex project workflows synchronized.

Skills are exact copies. Agent bodies may differ only in the explicit host
adaptations below; changing either version's workflow must update its counterpart.
"""

from pathlib import Path
import tomllib

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
CLAUDE_SKILLS = ROOT / ".claude/skills"
CODEX_SKILLS = ROOT / ".agents/skills"
CLAUDE_AGENTS = ROOT / ".claude/agents"
CODEX_AGENTS = ROOT / ".codex/agents"

# These literal pairs intentionally pin both versions. If the source guidance
# changes, review its Codex adaptation rather than silently ignoring the block.
HOST_ADAPTATIONS = (
    (
        """1. **Read the research memory**:
   `.claude/skills/inventree-stock-import/COMPONENT_RESEARCH.md`.""",
        """1. **Read the research memory**, `COMPONENT_RESEARCH.md`, provided by the
   project-level `inventree-stock-import` skill.""",
    ),
    (
        """- **alldatasheet.com: inject the site scripts on every visit.** Before the
  tab you use for alldatasheet loads any alldatasheet page, register the
  scripts in
  `.claude/skills/inventree-stock-import/browser-scripts/alldatasheet/` on that tab with
  `Page.addScriptToEvaluateOnNewDocument`, using the injector (it wraps each
  script to run once the DOM exists, which a new-document script otherwise
  does not):

  ```bash
  browser-harness <<'PY'
  import runpy
  new_tab("about:blank")   # or switch_tab() to the tab you will use
  runpy.run_path(
      ".claude/skills/"
      "inventree-stock-import/browser-scripts/inject.py",
      init_globals={**globals(), "SITE": "alldatasheet"})
  goto_url("https://www.alldatasheet.com/...")
  PY
  ```

  `01-hide-adblock-wall.js` hides the ad-block overlay and restores
  scrolling; `02-download-form.js` replaces the download page's form with a
  plain DOWNLOAD button. Register once per tab — a new tab needs it again,
  and registering twice on one tab runs the scripts twice. Do not edit the
  scripts; if one stops working, report it.
""",
        """- **alldatasheet.com: inject the site scripts on every visit.** Use the
  site scripts and injector provided by the project-level
  `inventree-stock-import` skill. Follow that skill's instructions to register
  them with `Page.addScriptToEvaluateOnNewDocument` before navigating to any
  alldatasheet page. Register once per tab; a new tab needs registration again.
  The scripts hide the ad-block overlay, restore scrolling, and replace the
  download form with a plain DOWNLOAD button. Do not edit them; if one stops
  working, report it.
""",
    ),
)


def skill_files(directory):
    """Ignore generated Python caches, but include every authored resource."""
    assert directory.is_dir(), f"Missing skill directory: {directory}"
    assert not directory.is_symlink(), f"Skills must be real copies: {directory}"
    files = {}
    for path in sorted(directory.rglob("*")):
        if "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        assert not path.is_symlink(), f"Skills must be real copies: {path}"
        if path.is_file():
            files[path.relative_to(directory)] = path
    assert files, f"No skill files found in {directory}"
    return files


def test_project_skill_copies_have_the_same_files():
    assert skill_files(CLAUDE_SKILLS).keys() == skill_files(CODEX_SKILLS).keys()


def test_project_skill_copies_have_identical_contents():
    source = skill_files(CLAUDE_SKILLS)
    target = skill_files(CODEX_SKILLS)
    different = [str(name) for name in source.keys() & target.keys()
                 if source[name].read_bytes() != target[name].read_bytes()]
    assert not different, "Skill copies differ: " + ", ".join(sorted(different))


def agent_names(directory, suffix):
    assert directory.is_dir(), f"Missing agent directory: {directory}"
    names = {path.stem for path in directory.glob(f"*{suffix}")}
    assert names, f"No agents found in {directory}"
    return names


def test_project_agents_have_matching_counterparts():
    assert agent_names(CLAUDE_AGENTS, ".md") == agent_names(CODEX_AGENTS, ".toml")


def codex_instructions(claude_body):
    """Apply only the reviewed differences in skill loading and tool names."""
    body = claude_body.strip()
    for source, target in HOST_ADAPTATIONS:
        body = body.replace(source, target)
    body = body.replace("(Skill tool)", "(a project-level skill)")
    body = body.replace("`chip-logo-identification` skill**",
                        "`chip-logo-identification` project-level skill**")
    return body.replace("plain `curl` or WebFetch",
                        "plain `curl` or the available web-fetch tool")


@pytest.mark.parametrize("name", sorted(path.stem for path in CLAUDE_AGENTS.glob("*.md")))
def test_codex_agent_matches_claude_workflow(name):
    source = (CLAUDE_AGENTS / f"{name}.md").read_text(encoding="utf-8")
    delimiter, frontmatter, body = source.split("---", 2)
    assert not delimiter.strip(), "Claude agent must start with YAML frontmatter"
    claude = yaml.safe_load(frontmatter)
    with (CODEX_AGENTS / f"{name}.toml").open("rb") as file:
        codex = tomllib.load(file)
    assert claude["name"] == codex["name"] == name
    assert codex["description"] == claude["description"]
    assert codex["developer_instructions"].strip() == codex_instructions(body)
    assert ".agents/skills/" not in codex["developer_instructions"]
    assert ".claude/skills/" not in codex["developer_instructions"]

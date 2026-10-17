# Project guidance

## Portable paths

Do not add local absolute file path references to repository files, including
instructions, examples, scripts, tests, skills, and agent definitions. Use
repository-relative paths, named project-level skills, environment variables,
or runtime path discovery instead. Do not embed a developer's checkout, home,
or temporary-directory paths. Standard interpreter shebangs and web/API paths
are unaffected by this rule.

## Shared skills

Project skills are maintained as duplicate copies in `.claude/skills/` and
`.agents/skills/`, so Claude Code and Codex can use the same workflows.

Whenever you create or modify a skill in this repository, make the same change
in both locations. This includes `SKILL.md` and all supporting scripts,
references, and assets. Mirror skill renames and deletions as well.

Before finishing a skill change, verify that the corresponding skill directories
contain the same files with identical contents. Keep them as real copies, not
symlinks.

## Custom agents in Codex

The Claude custom agents have Codex TOML counterparts in `.codex/agents/`:
`component-researcher`, `component-image-cropper`, and `company-logo-finder`.
When a shared skill calls for one of these Claude agent types, use the Codex
agent with the same name and pass the brief the skill specifies. References to
Claude's Skill tool mean loading the corresponding project-level skill by name
and following its instructions.

Keep each Claude custom agent and its Codex counterpart synchronized when
creating, modifying, renaming, or deleting agents. Preserve the same workflow
and description while adapting skill loading and tool references to each host.

## Testing

- Run `make test` for the normal suite. It excludes the slow scanner/TUI tests.
- After changing skills or agents, run
  `uv run pytest tests/test_project_workflow_sync.py`. These checks compare all
  skill files and agent counterparts, allowing only the explicitly reviewed
  Codex adaptations in the test.
- Run `make test-scanner` when changing scanner/TUI behavior; it installs the
  scanner extra and runs the TUI tests. Use `make test-all` to run both suites.
- Run `uv run ruff check` on changed Python files. Add or update regression tests
  for behavior changes, and report the checks run and any failures.

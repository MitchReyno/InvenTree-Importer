# Project guidance

## Read the code guidelines first

Agents must read the relevant code guidelines before writing, changing or reviewing any code, including tests and scripts. This is a requirement, not background reading:

- Always read the [shared code guidelines](CODE_GUIDELINES.md).
- Also read the guidelines of every application the work touches: [backend](backend/CODE_GUIDELINES.md), [frontend](frontend/CODE_GUIDELINES.md) or [intake server](intake-server/CODE_GUIDELINES.md).
- Packages without their own guidelines, such as `contracts`, `media-decoder` and `tooling`, follow the shared guidelines plus any guidelines their README names.

Read them in the current session before the first edit or the first review finding. A summary, memory or earlier session does not count, and a file that changes during the work must be read again. When delegating implementation or review to a subagent or another agent, name these files in the brief and require it to read them. A review checks the change against the guidelines and cites the rule each finding breaks.

## Project map

Read [ARCHITECTURE.md](ARCHITECTURE.md) for application ownership. For work in an application, also read its README and architecture: [backend](backend/README.md), [backend architecture](backend/ARCHITECTURE.md); [frontend](frontend/README.md), [frontend architecture](frontend/ARCHITECTURE.md); [intake server](intake-server/README.md), [intake-server architecture](intake-server/ARCHITECTURE.md). Keep the owning architecture and active references current when boundaries change. Current required behavior is in the [main specs](openspec/specs/); backend import execution follows the [durable import execution spec](openspec/specs/durable-import-execution/spec.md) and its sibling import specs. Plan nontrivial work as an OpenSpec change (see [docs/openspec.md](docs/openspec.md)) and record departures from the plan, unexpected challenges and open items in that change's `notes.md` as they happen. Do not write handover documents, even where an older plan under `docs/` still asks for one; this rule overrides those clauses. Put routine verification and review outcomes in the PR description, and attach evidence (screenshots, recordings, recorded output) there instead of committing it; see [evidence goes on the PR](CODE_GUIDELINES.md#evidence-goes-on-the-pr).

## Portable paths

Do not add local absolute file path references to repository files, including instructions, examples, scripts, tests, skills, and agent definitions. Use repository-relative paths, named project-level skills, environment variables, or runtime path discovery instead. Do not embed a developer's checkout, home, or temporary-directory paths. Standard interpreter shebangs and web/API paths are unaffected by this rule.

## Shared skills

Project skills are maintained as duplicate copies in `.claude/skills/` and `.agents/skills/`, so Claude Code and Codex can use the same workflows.

Whenever you create or modify a skill in this repository, make the same change in both locations. This includes `SKILL.md` and all supporting scripts, references, and assets. Mirror skill renames and deletions as well.

Before finishing a skill change, verify that the corresponding skill directories contain the same files with identical contents. Keep them as real copies, not symlinks.

## Custom agents in Codex

The Claude custom agents have Codex TOML counterparts in `.codex/agents/`: `component-researcher`, `component-image-cropper`, and `company-logo-finder`. When a shared skill calls for one of these Claude agent types, use the Codex agent with the same name and pass the brief the skill specifies. References to Claude's Skill tool mean loading the corresponding project-level skill by name and following its instructions.

Keep each Claude custom agent and its Codex counterpart synchronized when creating, modifying, renaming, or deleting agents. Preserve the same workflow and description while adapting skill loading and tool references to each host.

## Testing

- Run `pnpm test` for the normal suite. It excludes the slow scanner/TUI tests.
- After changing skills or agents, run `pnpm workflow-sync`. These checks compare all skill files and agent counterparts, allowing only the explicitly reviewed Codex adaptations in the test.
- Run `pnpm test:scanner` when changing scanner/TUI behavior; it installs the scanner extra and runs the TUI tests. Use `pnpm test:all` to run both suites.
- Run `pnpm lint:backend` (or `uv run --project backend ruff check --config backend/pyproject.toml backend`) on changed Python files. Add or update regression tests for behavior changes, and report the checks run and any failures.

## Repository layout and local data

The Python project is under `backend/` and remains uv-managed. The React/TypeScript intake scaffold is under `frontend/`, managed through the root pnpm workspace. Shared docs, skills and agents stay at repository root. From root use `uv run --project backend invimport ...` or `pnpm backend ...`; root pnpm checks delegate to the correct project. Use the pinned Node LTS in `.node-version` and package manager in root `package.json`. Run frontend typecheck, lint, tests and build after frontend changes.

Root `.env`, `.local_imports`, `.cache`, `.temp` and backups are not moved. Omitted managed data defaults from the backend cwd share root data; explicit relative arguments always retain caller-cwd meaning. Importer config defaults to `backend/config/`. Platform execution/scanner state and explicit state overrides retain their existing identity. Do not migrate, delete or reseed real local data as part of layout/tooling work. See `docs/repository-layout.md`.

## Initiative branch

The user-named `interactive-app` branch is the integration trunk for this initiative. Target the restructuring PR and subsequent initiative PRs to `interactive-app`, which starts at the reviewed main base. Keep work on separate conventional feature branches and obtain independent review before opening a PR. Do not merge initiative work into main as part of this change.

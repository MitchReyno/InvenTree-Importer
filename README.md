# InvenTree Importer workspace

This repository contains a Python component/inventory importer and a minimal browser intake scaffold. The backend is usable through its existing `invimport` CLI and library. The frontend currently previews selected file names/sizes only; it does not upload, process, approve or write inventory. The applications have no runtime connection yet.

| Start here                                     | Responsibility                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Backend README](backend/README.md)            | Python install/configuration, CLI/library usage, imports, synthetic demo, scanner and operational limits |
| [Frontend README](frontend/README.md)          | Scaffold setup, development, checks and current/future scope                                             |
| [Shared architecture](ARCHITECTURE.md)         | Cross-application map, ownership and implemented boundaries                                              |
| [Shared code guidelines](CODE_GUIDELINES.md)   | Cross-language engineering, effects, validation and review                                               |
| [Repository layout](docs/repository-layout.md) | Runtime paths, local data and source/installed-wheel behavior                                            |
| [AGENTS.md](AGENTS.md)                         | Project workflow, mirrored skills/agents and required checks                                             |

## Layout and toolchains

```text
backend/       uv-managed Python package, config, scripts and tests
frontend/      React + TypeScript + Vite application and component tests
docs/          operator/design documents, handovers and evidence
.agents/       mirrored project skills
.claude/       mirrored skills and Claude agents
.codex/        corresponding Codex agents
```

Each application has its own `README.md`, `ARCHITECTURE.md` and `CODE_GUIDELINES.md`. Shared guidance, CI, root pnpm control and documentation remain at repository root. Frontend dependencies/scripts live in its package; root owns one pnpm lockfile. Python retains its own backend uv lock and package identity. Use Python 3.12/uv and the Node/pnpm pins in `.node-version` and root `package.json`; follow each app README for installation.

## Root commands

After installing the application toolchains/dependencies as described in their READMEs, run from repository root:

```sh
pnpm dev                  # frontend loopback development server
pnpm build                # frontend production assets
pnpm typecheck
pnpm lint                 # Python, frontend and Markdown
pnpm test                 # normal backend suite and frontend tests
pnpm backend --help        # unchanged invimport CLI
pnpm demo --help           # synthetic loopback demonstration commands
pnpm workflow-sync        # mirrored skill/agent consistency
pnpm test:scanner         # scanner extra and scanner/TUI suite
pnpm test:all              # both normal/scanner and frontend suites
```

Root scripts also expose per-app checks. These commands delegate to existing application boundaries; they do not start a backend web service or connect the scaffold to inventory. The [backend guide](backend/README.md) documents explicit import approvals and limits.

Root `.env`, `.local_imports/`, caches and existing execution/scanner state are not moved or reset. Explicit relative arguments keep caller-cwd meaning. Read the [layout guide](docs/repository-layout.md) before running commands from another cwd or supplying state/config overrides. No real vendor/inventory credentials are needed for the frontend scaffold or the backend's isolated synthetic demo.

## Commit hooks and CI

After `uv sync --project backend --locked` and `pnpm install --frozen-lockfile`, opt in to the local hook with `pnpm hooks:install`. Hooks check staged files for merge conflicts, JSON/TOML/YAML syntax and large added files, run Ruff on changed Python files and ESLint when frontend code changes, and format/lint changed Markdown with remark. They do not run tests, builds or typechecks. Toolchain executables must be on PATH when committing. Installation is explicit because Git worktrees share a hooks directory; installing in one worktree affects commits in the others too.

Use `pnpm hooks:check` to check all tracked files manually; remark may rewrite Markdown, so inspect and restage any changes before committing. `pnpm lint:markdown` reports Markdown warnings with a failing exit status without rewriting files. `pnpm format:markdown` explicitly formats applicable Markdown across the repository. Both Markdown commands respect `.gitignore` and exclude local worktrees and review artifacts. Formatting supports GitHub tables/task lists and leaves prose unwrapped; it does not enforce a fixed line width. Existing Markdown lint findings are not bulk-fixed by this change.

GitHub Actions exposes one aggregate check named **CI**. It succeeds only when the backend tests and frontend typecheck/tests/build jobs succeed; failed, cancelled or skipped dependencies make it fail. The separate **lint** job runs Python, frontend and Markdown linting and remains a real failing check when any linter fails. It is intentionally excluded from the CI gate, with no `continue-on-error` masking. The overall workflow can therefore be red while CI is green. Configure branch protection/rulesets to require **CI**, not the advisory lint job or the entire workflow; this PR does not change repository protection settings.

## Initiative and contributions

`interactive-app` is the user-named integration trunk for this initiative, starting from the reviewed main base. Target this restructuring PR and subsequent initiative PRs there, using separate conventional feature branches and independent review before publication. No merge into main is part of this work.

Read the shared and owning app guidelines/architecture before changes. Keep future product/workflow plans explicitly labeled until implemented; this scaffold does not establish a backend API, database, runner or deployment design. The [relocation handover](docs/handovers/repository-layout.md) records decisions, validation, review and the documentation split.

Licensed under [GPLv3](LICENSE); see [third-party notices](THIRD-PARTY-NOTICES.md). DigiKey/InvenTree are their respective owners' trademarks; this independent tool is not affiliated with or endorsed by them. Vendor API obligations and credential handling are described in the [backend guide](backend/README.md#using-the-digikey-api).

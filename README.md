# InvenTree Importer workspace

This repository contains a Python component/inventory importer and a minimal browser intake scaffold. The backend is usable through its existing `invimport` CLI and library. The frontend currently previews selected file names/sizes only; it does not upload, process, approve or write inventory. The applications have no runtime connection yet.

| Start here                                      | Responsibility                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Backend README](backend/README.md)             | Python install/configuration, CLI/library usage, imports, synthetic demo, scanner and operational limits |
| [Frontend README](frontend/README.md)           | Scaffold setup, development, checks and current/future scope                                             |
| [Intake server README](intake-server/README.md) | Executable bootstrap, exact contracts/SQL, testing tiers and owned local service ledger                  |
| [Shared architecture](ARCHITECTURE.md)          | Cross-application map, ownership and implemented boundaries                                              |
| [Shared code guidelines](CODE_GUIDELINES.md)    | Cross-language engineering, effects, validation and review                                               |
| [Repository layout](docs/repository-layout.md)  | Runtime paths, local data and source/installed-wheel behavior                                            |
| [AGENTS.md](AGENTS.md)                          | Project workflow, mirrored skills/agents and required checks                                             |

## Layout and toolchains

```text
backend/       uv-managed Python package, config, scripts and tests
frontend/      React + TypeScript + Vite application and component tests
intake-server/ Fastify + PostgreSQL foundation, no product executor
contracts/     runtime schemas and generated OpenAPI/DTO/client
docs/          operator and design documents
.agents/       mirrored project skills
.claude/       mirrored skills and Claude agents
.codex/        corresponding Codex agents
```

Applications have owning READMEs and architecture; backend/frontend have language-specific guidelines, while intake specializes the shared rules in its [testing guidelines](intake-server/TESTING.md). Shared guidance, CI, root pnpm control and documentation remain at repository root. Node dependencies/scripts live in their packages; root owns one pnpm lockfile. Python retains its own backend uv lock and package identity. Use Python 3.12/uv and the Node/pnpm pins in `.node-version` and root `package.json`; follow each app README for installation.

## Root commands

After installing the application toolchains/dependencies as described in their READMEs, run from repository root:

```sh
pnpm dev                  # full retained local app at 127.0.0.1:4330
pnpm codex:login          # Codex subscription login for this dev app's private home
pnpm dev:ui               # standalone frontend development server
pnpm build                # frontend production assets
pnpm typecheck
pnpm lint                 # Python, frontend and Markdown
pnpm test                 # normal backend, frontend and fast intake tests
pnpm dev:intake            # standalone API with source-only reload; no workers
pnpm typecheck:intake      # contracts and intake-server
pnpm contracts:check       # generated OpenAPI/DTO/client drift
pnpm db:intake test        # explicit owned local PostgreSQL qualification
pnpm db:intake test:process # explicit synthetic DBOS process qualification
pnpm backend --help        # unchanged invimport CLI
pnpm demo --help           # synthetic loopback demonstration commands
pnpm workflow-sync        # mirrored skill/agent consistency
pnpm test:scanner         # scanner extra and scanner/TUI suite
pnpm test:all              # normal/scanner, frontend and fast intake suites
```

Root scripts also expose per-app checks. These commands delegate to existing application boundaries; they do not start a backend web service or connect the scaffold to inventory. The [backend guide](backend/README.md) documents explicit import approvals and limits.

Root `.env`, `.local_imports/`, caches and existing execution/scanner state are not moved or reset. Explicit relative arguments keep caller-cwd meaning. Read the [layout guide](docs/repository-layout.md) before running commands from another cwd or supplying state/config overrides. No real vendor/inventory credentials are needed for the frontend scaffold or the backend's isolated synthetic demo.

## Commit hooks and CI

After `uv sync --project backend --locked` and `pnpm install --frozen-lockfile`, opt in to the local hook with `pnpm hooks:install`. Hooks check staged files for merge conflicts, JSON/TOML/YAML syntax and large added files, format changed web/code files with Prettier, format and lint changed Python with Ruff, run ESLint when frontend code changes, and format/lint changed Markdown with remark. They do not run tests, builds or typechecks. Toolchain executables must be on PATH when committing. Installation is explicit because Git worktrees share a hooks directory; installing in one worktree affects commits in the others too.

Formatters can rewrite working files and cause the hook to fail with “files were modified”; inspect the diff, explicitly stage the intended changes, then retry. Hooks never `git add` for you. Pre-commit temporarily stashes unstaged edits and restores them; conflicting unstaged edits can cause it to roll back formatter fixes. Keep that output visible and resolve deliberately rather than silently staging the whole file. Use `pnpm hooks:check` for all tracked files only when you intend a broad check: it can rewrite legacy Python and Markdown. Routine commits enforce formatting on changed files, not a claim that all legacy files already comply.

### Formatting in CLI and VS Code

Open the **repository root** in VS Code, install the recommended **Prettier – Code formatter** (`esbenp.prettier-vscode`) and **Ruff** (`charliermarsh.ruff`) extensions, trust the workspace, and install dependencies with the commands above. Workspace settings select the locally pinned tools and enable format-on-save for JavaScript/JSX (including CJS/MJS), TypeScript/TSX (including CTS/MTS), JSON/JSONC, CSS and Python. Recommendations do not auto-install extensions; missing extensions/dependencies, an untrusted workspace or overriding editor settings can prevent formatting. Ruff paths cover the normal uv environment on Unix and Windows; custom `UV_PROJECT_ENVIRONMENT` users must point their editor's Ruff path at that environment. No global user settings are changed.

```sh
pnpm format                          # write eligible web/code files, not Python/Markdown
pnpm format:check                    # same web/code scope, report only; nonzero on drift
pnpm exec prettier --write frontend/src/App.tsx # individual web/code paths
pnpm format:python backend/src/invimport/example.py       # use actual changed paths
pnpm format:python:check backend/src/invimport/example.py # report only
pnpm format:markdown                 # existing remark workflow, repository-wide
pnpm test:formatting                 # real CLI/hooks in disposable Git fixtures
```

Prettier's root config is shared by CLI, editor and hook: single quotes, no semicolons, 100-column preferred code width, no embedded-template formatting. `.prettierignore` allows only the listed web/code extensions and excludes backend/spikes/docs, mirrored workflow assets, generated output, vectors, fixtures, migrations and local/cache/build/worktree artifacts. This preserves original mockups/screenshots under `docs/bench-intake/reference/`, immutable SQL migrations, generated contracts and byte-sensitive evidence. It deliberately leaves fixture helper code outside Prettier too. Binary/media files are not formatter inputs. Do not use the editor's **Format Document (Forced)** to bypass ignores on preserved artifacts.

Ruff uses `backend/pyproject.toml` in CLI/editor/hook; the Python commands accept paths (without paths they scan the current directory). Formatter-specific excludes and the hook's `--force-exclude` protect evidence/generated/local-data paths without weakening lint. Existing Python is not mass-reformatted: format the files you change and inspect their mechanical diffs. This PR baselines eligible web/code sources, not every language in the repository. New preserved/generated locations must be added to the owning ignore policy before formatting them.

Markdown remains solely remark's responsibility, not Prettier's. VS Code disables Markdown format-on-save and enables soft wrapping; use the existing CLI/hook formatter. `pnpm lint:markdown` reports warnings without rewriting; `pnpm format:markdown` writes applicable Markdown. Both respect `.gitignore` and exclude local worktrees/review artifacts. Remark supports GitHub tables/task lists and keeps prose unwrapped, with no fixed line width. Existing Markdown lint findings are not bulk-fixed. HTML, YAML and SQL are not opted into code formatting; syntax hooks still check JSON/TOML/YAML. No new formatting CI gate or changes to required checks are introduced; existing generated-artifact drift checks retain their exact-byte contract.

GitHub Actions runs optional, path-aware checks on every PR and pushes to `main` / `interactive-app`. **Changed paths** always tests the selector; reusable **Test** and **Lint** jobs run only relevant application/tooling checks. Backend, frontend and intake contracts/HTTP checks remain separately visible; frontend retains its typecheck/build. Intake-only code does not select the Python importer or the currently disconnected frontend; docs-only changes select Markdown, not server/backend tests. Workspace dependencies and CI changes conservatively select their consumers. CI does not run the intake PostgreSQL/process tiers: that job is disabled because it exceeds the included free Actions minutes, and shows as skipped. Run `pnpm db:intake test` and `pnpm db:intake test:process` locally before review and record the results in the PR description. If the job is re-enabled it uses a fresh CI-only PostgreSQL service and explicit fake/sandbox settings, never Docker development credentials or root `.env`. See [testing tiers](intake-server/TESTING.md).

There is no aggregate required **CI** gate, `continue-on-error` or success-forcing job: every selected failure remains a workflow failure; unselected jobs skip natively. The coordinator removed only required status checks from repository ruleset 26298509, preserving history protection (recorded provenance in T00). Optional branch checks do not waive this initiative's review/merge process: selected relevant checks must pass before coordinator merge. Do not reinstate the obsolete required aggregate or count skips as passing coverage. No application tests run in the local pre-commit hook.

## Initiative and contributions

`interactive-app` is the user-named integration trunk for this initiative, starting from the reviewed main base. Target initiative PRs there on separate conventional feature branches. Work is planned as [OpenSpec changes](docs/openspec.md), and each PR needs a fresh independent review of its exact head and passing selected checks before it merges. No merge into main is part of this work.

Read the shared and owning app guidelines/architecture before changes. Keep future product/workflow plans explicitly labeled until implemented; the file-picker scaffold is not capture/approval, and the separate intake foundation is not an inventory executor or release-qualified deployment.

Licensed under [GPLv3](LICENSE); see [third-party notices](THIRD-PARTY-NOTICES.md). DigiKey/InvenTree are their respective owners' trademarks; this independent tool is not affiliated with or endorsed by them. Vendor API obligations and credential handling are described in the [backend guide](backend/README.md#using-the-digikey-api).

See [local app development](docs/development.md) for `.env` configuration, fake or read-only external InvenTree targets, full-stack startup, source-only reload, retained data and synthetic/native Processing selection. Start from `.env.intake.example` without overwriting an existing environment file.

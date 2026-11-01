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
docs/          operator/design documents, handovers and evidence
.agents/       mirrored project skills
.claude/       mirrored skills and Claude agents
.codex/        corresponding Codex agents
```

Applications have owning READMEs and architecture; backend/frontend have language-specific guidelines, while intake specializes the shared rules in its [testing guidelines](intake-server/TESTING.md). Shared guidance, CI, root pnpm control and documentation remain at repository root. Node dependencies/scripts live in their packages; root owns one pnpm lockfile. Python retains its own backend uv lock and package identity. Use Python 3.12/uv and the Node/pnpm pins in `.node-version` and root `package.json`; follow each app README for installation.

## Root commands

After installing the application toolchains/dependencies as described in their READMEs, run from repository root:

```sh
pnpm dev                  # frontend loopback development server
pnpm build                # frontend production assets
pnpm typecheck
pnpm lint                 # Python, frontend and Markdown
pnpm test                 # normal backend, frontend and fast intake tests
pnpm dev:intake            # loopback development bootstrap API, no worker/inventory calls
pnpm typecheck:intake      # contracts and intake-server
pnpm contracts:check       # generated OpenAPI/DTO/client drift
pnpm db:intake test        # explicit owned local PostgreSQL qualification
pnpm db:intake test:process # explicit synthetic DBOS process qualification
pnpm backend --help        # unchanged invimport CLI
pnpm demo --help           # synthetic loopback demonstration commands
pnpm workflow-sync        # mirrored skill/agent consistency
pnpm test:scanner         # scanner extra and scanner/TUI suite
pnpm test:all              # normal/scanner, frontend and fast intake suites
pnpm spikes:check          # offline shared intake-spike contract and fixtures
```

Root scripts also expose per-app checks. These commands delegate to existing application boundaries; they do not start a backend web service or connect the scaffold to inventory. The [backend guide](backend/README.md) documents explicit import approvals and limits.

Root `.env`, `.local_imports/`, caches and existing execution/scanner state are not moved or reset. Explicit relative arguments keep caller-cwd meaning. Read the [layout guide](docs/repository-layout.md) before running commands from another cwd or supplying state/config overrides. No real vendor/inventory credentials are needed for the frontend scaffold or the backend's isolated synthetic demo.

## Commit hooks and CI

After `uv sync --project backend --locked` and `pnpm install --frozen-lockfile`, opt in to the local hook with `pnpm hooks:install`. Hooks check staged files for merge conflicts, JSON/TOML/YAML syntax and large added files, run Ruff on changed Python files and ESLint when frontend code changes, and format/lint changed Markdown with remark. They do not run tests, builds or typechecks. Toolchain executables must be on PATH when committing. Installation is explicit because Git worktrees share a hooks directory; installing in one worktree affects commits in the others too.

Use `pnpm hooks:check` to check all tracked files manually; remark may rewrite Markdown, so inspect and restage any changes before committing. `pnpm lint:markdown` reports Markdown warnings with a failing exit status without rewriting files. `pnpm format:markdown` explicitly formats applicable Markdown across the repository. Both Markdown commands respect `.gitignore` and exclude local worktrees and review artifacts. Formatting supports GitHub tables/task lists and leaves prose unwrapped; it does not enforce a fixed line width. Existing Markdown lint findings are not bulk-fixed by this change.

GitHub Actions runs optional, path-aware checks on every PR and pushes to `main` / `interactive-app`. **Changed paths** always tests the selector; reusable **Test** and **Lint** jobs run only relevant application/tooling checks. Backend, frontend, intake contracts/HTTP and intake PostgreSQL/process checks remain separately visible; frontend retains its typecheck/build. Intake-only code does not select the Python importer or the currently disconnected frontend; docs-only changes select Markdown, not server/backend tests. Workspace dependencies and CI changes conservatively select their consumers. The intake PG job uses a fresh CI-only PostgreSQL service and explicit fake/sandbox settings, never Docker development credentials or root `.env`. See [testing tiers](intake-server/TESTING.md) and the [T00 selection contract](docs/handovers/bench-intake-T00-ci.md).

There is no aggregate required **CI** gate, `continue-on-error` or success-forcing job: every selected failure remains a workflow failure; unselected jobs skip natively. The coordinator removed only required status checks from repository ruleset 26298509, preserving history protection (recorded provenance in T00). Optional branch checks do not waive this initiative's review/merge process: selected relevant checks must pass before coordinator merge. Do not reinstate the obsolete required aggregate or count skips as passing coverage. No application tests run in the local pre-commit hook.

## Initiative and contributions

`interactive-app` is the user-named integration trunk for this initiative, starting from the reviewed main base. Target initiative PRs there on separate conventional feature branches. The approved [Bench Intake workflow](docs/bench-intake/08-implementation-plan.md#owner-reviewer-and-merge-protocol) publishes a ready PR first, then requires fresh independent review and passing selected checks before coordinator merge. No merge into main is part of this work.

Read the shared and owning app guidelines/architecture before changes. Keep future product/workflow plans explicitly labeled until implemented; the file-picker scaffold is not capture/approval, and the separate intake foundation is not an inventory executor or release-qualified deployment. The [relocation handover](docs/handovers/repository-layout.md) records historical layout decisions; the [T01 handover](docs/handovers/bench-intake-T01.md) records the new implemented boundary and evidence.

Licensed under [GPLv3](LICENSE); see [third-party notices](THIRD-PARTY-NOTICES.md). DigiKey/InvenTree are their respective owners' trademarks; this independent tool is not affiliated with or endorsed by them. Vendor API obligations and credential handling are described in the [backend guide](backend/README.md#using-the-digikey-api).

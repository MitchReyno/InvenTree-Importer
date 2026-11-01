# InvenTree Importer workspace

This repository contains a Python component/inventory importer and a minimal browser intake scaffold. The backend is usable through its existing `invimport` CLI and library. The frontend currently previews selected file names/sizes only; it does not upload, process, approve or write inventory. The applications have no runtime connection yet.

| Start here | Responsibility |
| --- | --- |
| [Backend README](backend/README.md) | Python install/configuration, CLI/library usage, imports, synthetic demo, scanner and operational limits |
| [Frontend README](frontend/README.md) | Scaffold setup, development, checks and current/future scope |
| [Shared architecture](ARCHITECTURE.md) | Cross-application map, ownership and implemented boundaries |
| [Shared code guidelines](CODE_GUIDELINES.md) | Cross-language engineering, effects, validation and review |
| [Repository layout](docs/repository-layout.md) | Runtime paths, local data and source/installed-wheel behavior |
| [AGENTS.md](AGENTS.md) | Project workflow, mirrored skills/agents and required checks |

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
pnpm lint                 # backend and frontend
pnpm test                 # normal backend suite and frontend tests
pnpm backend --help        # unchanged invimport CLI
pnpm demo --help           # synthetic loopback demonstration commands
pnpm workflow-sync        # mirrored skill/agent consistency
pnpm test:scanner         # scanner extra and scanner/TUI suite
pnpm test:all              # both normal/scanner and frontend suites
pnpm spikes:check          # offline shared intake-spike contract and fixtures
```

Root scripts also expose per-app checks. These commands delegate to existing application boundaries; they do not start a backend web service or connect the scaffold to inventory. The [backend guide](backend/README.md) documents explicit import approvals and limits.

Root `.env`, `.local_imports/`, caches and existing execution/scanner state are not moved or reset. Explicit relative arguments keep caller-cwd meaning. Read the [layout guide](docs/repository-layout.md) before running commands from another cwd or supplying state/config overrides. No real vendor/inventory credentials are needed for the frontend scaffold or the backend's isolated synthetic demo.

## Initiative and contributions

`interactive-app` is the user-named integration trunk for this initiative, starting from the reviewed main base. Target this restructuring PR and subsequent initiative PRs there, using separate conventional feature branches and independent review before publication. No merge into main is part of this work.

Read the shared and owning app guidelines/architecture before changes. Keep future product/workflow plans explicitly labeled until implemented; this scaffold does not establish a backend API, database, runner or deployment design. The [relocation handover](docs/handovers/repository-layout.md) records decisions, validation, review and the documentation split.

Licensed under [GPLv3](LICENSE); see [third-party notices](THIRD-PARTY-NOTICES.md). DigiKey/InvenTree are their respective owners' trademarks; this independent tool is not affiliated with or endorsed by them. Vendor API obligations and credential handling are described in the [backend guide](backend/README.md#using-the-digikey-api).

# Repository workspace and runtime paths

The root is the pnpm workspace/control point. `backend/` contains the existing uv-managed Python project, package `invimport`, CLI, config, scripts and tests. `frontend/` contains a minimal React/TypeScript/Vite intake scaffold. Shared docs, architecture, CI, mirrored skills and custom agents remain at root.

The scaffold lets you select/remove files and inspect their metadata in memory. It does not upload, parse, persist, call the importer or provide approval/inventory behavior. Its Vite server binds to loopback and has no backend proxy. This PR does not implement the separate product design or choose a workflow engine.

## Setup and commands

Use Python 3.12, uv, Node from `.node-version` and pnpm from root `packageManager`. The frontend is pinned to React 19, Vite 8, TypeScript 6 and pnpm 12. TypeScript 6 matches the lint tooling's supported peer range; the current TypeScript 7 release is deliberately deferred. Node 24 is a maintained LTS line. These are separate from Python's unchanged dependency lock and version requirement.

From the repository root:

```sh
uv sync --project backend --locked
pnpm install --frozen-lockfile
pnpm dev                     # local-only frontend
pnpm build
pnpm typecheck
pnpm lint                    # backend and frontend
pnpm test                    # backend normal suite and frontend
pnpm backend --help          # unchanged invimport CLI
pnpm demo --help             # loopback fake service demo
pnpm workflow-sync
pnpm test:scanner            # installs scanner extra, runs scanner/TUI tests
pnpm test:all
```

`uv sync --project backend` creates `backend/.venv`. Do not move or reuse an old root `.venv`; it can remain untracked while uv creates the new environment. `cd backend && uv run invimport ...` also works. Tests from root should use `uv run --project backend pytest backend/tests`; selecting a uv project does not change the subprocess working directory. Root pnpm scripts select the proper Python cwd and config automatically. An editable CLI install is `uv tool install --editable ./backend`; its package name and command stay the same. The root has a single pnpm lockfile and the frontend owns its dependencies/scripts.

## Existing local data is retained

No environment, cache, import data or journal is migrated, copied or deleted. Source/editable installs recognize only their own exact `backend/src/invimport` relationship plus the root workspace markers. They do not search cwd/ancestors for an arbitrary repository. A legacy flat source layout remains supported.

| Input/state | Relocated checkout behavior |
| --- | --- |
| Omitted `.env` | Root `.env`, anchored to package source, from any cwd |
| Omitted importer config | `backend/config/`, anchored to package source |
| Omitted cache directory | Root `.cache/` from root or `backend/`; other cwd retains cwd-relative behavior |
| Omitted scanner pending export directory | Root `.local_imports/` from root or `backend/`; other cwd retains cwd-relative behavior |
| Explicit relative import, config, env, cache or scanner export path | Relative to the actual caller cwd, without aliasing |
| Platform execution/scanner state | Existing platform directory, unchanged |
| `INVIMPORT_STATE_DIR` | Existing absolute-only validation and exact chosen namespace, unchanged |
| Demo workspace | Explicit workspace, private fake data/config/home/state; inherited credentials/proxies stripped |

Run real imports from root as before when using `.local_imports/...` arguments. From `backend/`, an explicitly supplied import path must be `../.local_imports/...`. Direct Python library calls retain cwd; only omitted managed defaults use the backend-to-root data alias. No process-wide chdir or data migration is performed. The inventory wipe script's omitted backup directory remains root `backups/`.

## Installed distributions

The wheel still contains the `invimport` package only, without config, tests, scripts, frontend or repository `.env`. Outside a source checkout its default config/env fallback remains package-relative as before; supply explicit `--config` and `--env-file` when those defaults are absent. It does not adopt an unrelated nearby workspace. Distribution of default config remains an existing limitation, not a new packaging feature of this relocation.

See the [shared architecture](../ARCHITECTURE.md) and [backend architecture](../backend/ARCHITECTURE.md) for application/execution boundaries and [the handover](handovers/repository-layout.md) for checks and decisions.

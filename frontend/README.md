# Intake scaffold

React + TypeScript + Vite, managed by the root pnpm workspace. This is a local file-name/size preview only: select, remove and clear files in browser memory. Selections disappear on refresh. It does not upload or parse files, call the importer, persist data, approve work or provide a backend API. No proxy or vendor/inventory credentials are configured.

Read the [root README](../README.md), [shared architecture](../ARCHITECTURE.md), [frontend architecture](ARCHITECTURE.md), [shared guidelines](../CODE_GUIDELINES.md) and [frontend guidelines](CODE_GUIDELINES.md) for responsibilities and change policy.

## Setup and commands

Run these commands from repository root, using Node from `.node-version` and pnpm from root `packageManager`. Dependencies/scripts belong to `frontend/package.json`; the single lockfile and package-manager pin stay at root.

```sh
pnpm install --frozen-lockfile
pnpm dev                  # loopback-only Vite development server
pnpm typecheck
pnpm lint:frontend
pnpm test:frontend
pnpm build                # ignored frontend/dist production assets
```

The root `pnpm lint`/`pnpm test` also run backend checks, which need the Python/uv setup in the [backend README](../backend/README.md). Frontend-only development does not require live inventory/vendor services or Python execution. No hosting is configured; a successful build does not deploy the application.

## Current and future scope

The visible scaffold labels are intentional. File input extensions are a chooser hint, not validation. Component tests cover file selection/removal/clear, duplicate names and absence of fetch calls; they are not end-to-end product acceptance. There is no connection to the backend's durable import approvals or journals.

Upload, processing/progress, review, approval, results, authentication and persistence require future reviewed interfaces and implementation. They are not working routes or selected infrastructure in this scaffold. Keep those plans separate from the [current architecture](ARCHITECTURE.md).

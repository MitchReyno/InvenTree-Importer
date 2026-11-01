# Bench Intake manual capture

React + TypeScript + Vite with styled-components, managed by the root pnpm workspace. Manual batches, human notes, distinct lots/shared Part proposals and exact selections are retained through the same-origin intake API/PostgreSQL. Refresh resumes saved work. Capture cannot upload, infer, approve, apply or mutate inventory. Read-only existing Part/location observations require an explicitly configured fixed server target, never browser credentials.

Read the [root README](../README.md), [shared architecture](../ARCHITECTURE.md), [frontend architecture](ARCHITECTURE.md), [shared guidelines](../CODE_GUIDELINES.md) and [frontend guidelines](CODE_GUIDELINES.md) for responsibilities and change policy.

## Setup and commands

Run these commands from repository root, using Node from `.node-version` and pnpm from root `packageManager`. Dependencies/scripts belong to `frontend/package.json`; the single lockfile and package-manager pin stay at root.

```sh
pnpm install --frozen-lockfile
pnpm dev                  # standalone Vite, no API proxy configured
pnpm typecheck
pnpm lint:frontend
pnpm test:frontend
pnpm build                # ignored frontend/dist production assets
pnpm dev:intake           # same-origin built UI + API; explicit capture DB setup required
```

The root `pnpm lint`/`pnpm test` also run backend checks, which need the Python/uv setup in the [backend README](../backend/README.md). Capture development needs no Python execution or real inventory services; see [explicit server setup and service ownership](../intake-server/README.md). No production deployment is configured; a successful build does not deploy the application.

## Current and future scope

The visible development banner and unavailable later stages are intentional. Component tests cover exact text scalars, human attribution, retained URL resume, revision conflicts and archive/resume. Real HTTP/PG/process/browser evidence is in the [T02 handover](../docs/handovers/bench-intake-T02.md); jsdom alone is not end-to-end proof. Read the [primary original prototype and screenshots](../docs/bench-intake/reference/README.md) before changing layout; preserve the user-approved current light/blue palette.

Upload, processing/progress, review, approval, results and final identity/access qualification need later reviewed interfaces. There is no connection to Python approvals/journals or unmerged executor SQL. Keep those plans separate from the [current architecture](ARCHITECTURE.md).

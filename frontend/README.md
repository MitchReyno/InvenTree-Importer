# Bench Intake operator application

React + TypeScript + Vite with styled-components, managed by the root pnpm workspace. Manual batches, human notes, distinct lots/shared Part proposals and exact selections are retained through the same-origin intake API/PostgreSQL. Refresh resumes saved work. Capture supports optional retained uploads and documentary cropping; Review and Changes use explicit retained commands against an owned fake. Actual provider inference and real inventory mutation remain unavailable. Read-only existing Part/location observations require an explicitly configured fixed server target, never browser credentials.

Read the [root README](../README.md), [shared architecture](../ARCHITECTURE.md), [frontend architecture](ARCHITECTURE.md), [shared guidelines](../CODE_GUIDELINES.md) and [frontend guidelines](CODE_GUIDELINES.md) for responsibilities and change policy.

## Setup and commands

Run these commands from repository root, using Node from `.node-version` and pnpm from root `packageManager`. Dependencies/scripts belong to `frontend/package.json`; the single lockfile and package-manager pin stay at root.

```sh
pnpm install --frozen-lockfile
pnpm dev:ui               # standalone Vite, no API proxy configured
pnpm typecheck
pnpm lint:frontend
pnpm test:frontend
pnpm build                # ignored frontend/dist production assets
pnpm dev:intake           # same-origin built UI + API; explicit capture DB setup required
```

### Screenshot diff

`pnpm screenshots:frontend` captures every page in `tests/fixtures/` in headless Chrome, in light and dark at 1440 and 390 px wide, and fails when any pixel differs from the recorded baseline. It proves that a change, such as swapping literal values for equal tokens, leaves every screen pixel-identical.

```sh
pnpm screenshots:frontend -- --update        # record the baseline before the change
pnpm screenshots:frontend                     # compare after it; lists each changed shot
pnpm screenshots:frontend -- --out <dir>      # also write the shots and a .diff.png for each change
pnpm screenshots:frontend -- --only records   # limit to fixture pages whose name contains "records"
```

The script starts its own Vite server and needs Chrome (`CHROME_PATH` overrides its location). The baseline is local, in the gitignored `frontend/.screenshots/baseline`, so record it on the base commit before changing anything. Captures freeze animations and transitions, hide the decorative masthead scene, and use CPU rasterisation, so an unchanged page is identical from run to run. Screenshots are evidence for the PR description, not committed files.

### Unused code

`pnpm lint:unused` runs [knip](https://knip.dev) over `frontend`, `contracts` and `intake-server` (configured in `knip.json` at the root) and fails when unused files, exports, types or dependencies grow beyond `tooling/unused-code/baseline.json`. The baseline records unused code that predates the check, which BI-011 removes; it may only shrink, and a stale baseline fails until it is recorded smaller with `node tooling/unused-code/check.mjs --update-baseline`. A change deletes the code it makes unused. Code kept for planned work stays with a tag naming that work: `/** @planned BI-005 <why> */` on an export, or the same in a file's first comment to keep the whole file; a tag that names no `BI-NNN` item or `task N.N` fails the check.

The root `pnpm lint`/`pnpm test` also run backend checks, which need the Python/uv setup in the [backend README](../backend/README.md). Capture development needs no Python execution or real inventory services; see [explicit server setup and service ownership](../intake-server/README.md). No production deployment is configured; a successful build does not deploy the application.

## Current and future scope

The visible `Dev mode` header badge, diagnostics attribution, provider capability notices and the test-target note in Changes are intentional. Component tests cover exact text scalars, human attribution, retained URL resume, revision conflicts and archive/resume, but jsdom alone is not end-to-end proof. Read the [primary original prototype and screenshots](../docs/bench-intake/reference/README.md) before changing layout; preserve the user-approved current light/blue palette.

The inbox provides explicit Capture, Processing, Review and Changes links, a recent-batch card and server-wide title search with ten-row paging, retained original thumbnails and workflow observations. Search is explicitly submitted; typing sends no requests. Counts and latest-round outcomes come from the scoped inbox projection and do not authorize commands. Batch headers show the four tabs, visible development attribution and the decorative masthead.

Review keeps the physical-lot queue, a large read-only evidence viewer and the decision panel together. Select an exact retained source/version/page, zoom up to 300% and scroll its authorized preview; notes remain below it. Polling preserves that exact selection, including an unavailable state when it disappears. Exact source/version/page/preview selection persists in the URL; zoom remains local to the focused lot. Invalid or missing pinned evidence requires explicit selection. New shared Part choices are labelled as creates rather than missing existing selections.

Processing jobs/questions and research candidates remain fixture-only. Full identity/access, live event transport, operational recovery and release qualification remain future work. There is no connection to Python approvals/journals or unmerged executor SQL. See the [current architecture](ARCHITECTURE.md).

Root `pnpm dev` starts the [full local app](../docs/development.md), including a same-origin HTTP/WebSocket development proxy and source-driven reload. Standalone `dev:ui` does not provision services.

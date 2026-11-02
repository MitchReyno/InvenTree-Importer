# Bench Intake operator application

React + TypeScript + Vite with styled-components, managed by the root pnpm workspace. Manual batches, human notes, distinct lots/shared Part proposals and exact selections are retained through the same-origin intake API/PostgreSQL. Refresh resumes saved work. Capture supports optional retained uploads and documentary cropping; Review, Approve and Results use explicit retained commands against an owned fake. Actual provider inference and real inventory mutation remain unavailable. Read-only existing Part/location observations require an explicitly configured fixed server target, never browser credentials.

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

The visible development banner and owned-fake/provider capability notices are intentional. Component tests cover exact text scalars, human attribution, retained URL resume, revision conflicts and archive/resume. Real HTTP/PG/process/browser evidence is in the [T02 handover](../docs/handovers/bench-intake-T02.md); jsdom alone is not end-to-end proof. Read the [primary original prototype and screenshots](../docs/bench-intake/reference/README.md) before changing layout; preserve the user-approved current light/blue palette.

The inbox provides explicit Capture, Processing, Review and Results links, a recent-batch card and server-wide title search with ten-row paging, retained original thumbnails and workflow observations. Search is explicitly submitted; typing sends no requests. Counts and latest-round outcomes come from the scoped inbox projection and do not authorize commands. Compact shared headers retain all five stages, visible development attribution and the decorative masthead.

Review keeps the physical-lot queue, a large read-only evidence viewer and the decision panel together. Select an exact retained source/version/page, zoom up to 300% and scroll its authorized preview; notes remain below it. Polling preserves that exact selection, including an unavailable state when it disappears. Exact source/version/page/preview selection persists in the URL; zoom remains local to the focused lot. Invalid or missing pinned evidence requires explicit selection. New shared Part choices are labelled as creates rather than missing existing selections.

Processing jobs/questions and research candidates remain fixture-only. Full identity/access, live event transport, operational recovery and release qualification remain future work. There is no connection to Python approvals/journals or unmerged executor SQL. See the [current architecture](ARCHITECTURE.md) and [design-alignment task record](../docs/handovers/bench-intake-design-alignment.md) for evidence and limitations.

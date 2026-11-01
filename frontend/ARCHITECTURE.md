# Frontend architecture

This document describes the implemented manual capture application under `frontend/`. Read the [shared architecture](../ARCHITECTURE.md), [shared guidelines](../CODE_GUIDELINES.md) and [frontend guidelines](CODE_GUIDELINES.md) for its boundaries and change policy.

## Current application

React and TypeScript run in a Vite browser application. `index.html` loads `src/main.tsx`, which mounts `App` under React StrictMode. `src/App.tsx` uses the validated generated contracts client against the same-origin Fastify API. Bootstrap supplies a visible development-attribution banner and ephemeral CSRF token, never an inventory key. Retained batch list/create/read/edit/archive commands store state in PostgreSQL, not localStorage. A hash URL retains batch and selected subject/editor; refresh loads saved server state. Closing the browser does not erase batches or notes.

`src/capture/Workspace.tsx` owns the compact lot queue, human-note/context panel and focused details editor. Shared Part proposals never combine physical lots. Exact quantity and PK strings stay strings; notes visibly identify human provenance. Defaults and explicit lot selections retain unset/unknown/clear/inherit/set distinctions. Reading a configured target's existing Part/location creates an observation; selecting it is a separate human action. No browser command accepts a target URL, actor or inventory secret. Only manual quantity, location, existing Part choice, labels, links and append-only notes are implemented.

Each save carries the loaded batch revision. A 412 preserves local inputs and displays current saved values; explicit discard/reload is required, never silent rebase or last-write-wins. A single dirty editor disables subject navigation/archive, with explicit discard. A failed/uncertain save remains visibly unconfirmed; it is not blindly retried. Archive retains history and disables editing until explicit resume. There is no upload, provider, review, approval, executor or Python runtime connection. Four later stages remain accurately unavailable, including a distinct Approve stage.

`src/styles.css` owns the light/neutral palette and blue selection explicitly approved by Mitch. Layout/UX follows the primary [original HTML prototype](../docs/bench-intake/reference/bench-intake.html), [Capture](../docs/bench-intake/reference/03-capture.png), [Review workspace](../docs/bench-intake/reference/02-review.png), [Inbox](../docs/bench-intake/reference/01-inbox.png) and [phone frame](../docs/bench-intake/reference/10-phone.png); see the [reference index and historical limitations](../docs/bench-intake/reference/README.md) before the secondary derivative board. Authoritative [experience wireframes](../docs/bench-intake/05-experience.md) and latest contracts override prototype simulations. Desktop uses queue/context/details; narrow screens use list → focused subject with explicit back navigation and retained context above editable fields. No fake media or active review controls are added to mimic unavailable breadth.

`src/App.test.tsx` covers exact string emission, human attribution, archive/resume and concurrent-edit conflict through a jsdom/component boundary. Actual loopback server/browser/restart and inspected desktop/narrow/nondefault screenshots are recorded in the [T02 handover](../docs/handovers/bench-intake-T02.md); component tests alone are not browser or production-access qualification.

## Tooling and application ownership

Frontend dependencies and scripts live in `package.json` here. Root pnpm owns the workspace/control point and single lockfile; `.node-version` and root `packageManager` pin the toolchain. React/Vite/TypeScript/plugin versions are pinned in the frontend manifest; Python dependencies stay entirely in backend.

`vite.config.ts` configures React, a loopback-only dev/preview host and Vitest with jsdom plus `src/test-setup.ts`. It has no backend proxy or root `envDir` override. Use `pnpm build` and `pnpm dev:intake` for the integrated same-origin UI; the server serves only built `frontend/dist` through `@fastify/static`. `pnpm dev` remains a standalone Vite presentation server, not a configured API proxy. The frontend does not load root inventory/vendor credentials. No credential belongs in client-exposed Vite variables. `tsconfig.json` enables strict checking; `eslint.config.js` provides configured lint rules. A successful build does not deploy anything.

From repository root, `pnpm dev`, `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend` and `pnpm build` delegate to this application. Root normal tests also run backend checks. See [repository layout](../docs/repository-layout.md).

## Future work — not implemented

Upload/media retention, processing/progress, provider inference, review, approval, results, broader shared metadata and final InvenTree authentication/access qualification remain future work, not hidden features. Existing capture source/contribution identities, immutable human notes and exact selection histories are the future integration seam; do not replace them with a disposable browser draft or copy historical prototype timers/localStorage. T04 connects separately merged capture and execution through reviewed public contracts, not sibling SQL internals. Normal remote/phone deployment is not enabled by changing the loopback bind.

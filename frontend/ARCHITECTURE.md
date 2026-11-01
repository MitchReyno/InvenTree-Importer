# Frontend architecture

This document describes the implemented intake scaffold under `frontend/`. Read the [shared architecture](../ARCHITECTURE.md), [shared guidelines](../CODE_GUIDELINES.md) and [frontend guidelines](CODE_GUIDELINES.md) for its boundaries and change policy.

## Current application

React and TypeScript run in a Vite browser application. `index.html` loads `src/main.tsx`, which mounts `App` under React StrictMode. `src/App.tsx` owns an in-memory list of selected File objects plus ephemeral random UI IDs. It renders file names/sizes and supports adding, removing and clearing entries. Two files with the same name remain separate selections. IDs identify only this UI list; they are not source, import, request or inventory identities.

The native file input advertises list/receipt/photo extensions as a chooser hint. It does not validate or interpret their bytes. The app does not read file content, upload, parse, persist or call the importer. Refresh/navigation loses selections. The visible “Intake scaffold” and “Local preview” labels describe this limit. There is no approval/result workflow, authentication, API client, backend service or inventory effect behind the screen.

`src/styles.css` owns the current responsive presentation. The interface uses a labeled file input, list, named removal controls and live selection count; browser behavior and accessibility still need validation as the application grows. `src/App.test.tsx` exercises selection/removal/clear, duplicate filenames and no fetch calls through a jsdom/component test boundary. These tests are not a full browser, product acceptance or upload-security guarantee.

## Tooling and application ownership

Frontend dependencies and scripts live in `package.json` here. Root pnpm owns the workspace/control point and single lockfile; `.node-version` and root `packageManager` pin the toolchain. React/Vite/TypeScript/plugin versions are pinned in the frontend manifest; Python dependencies stay entirely in backend.

`vite.config.ts` configures React, a loopback-only dev/preview host and Vitest with jsdom plus `src/test-setup.ts`. It has no backend proxy or root `envDir` override. The frontend does not load root inventory/vendor credentials. No credential should be placed in client-exposed Vite variables. `tsconfig.json` enables strict checking; `eslint.config.js` provides the configured JS/TypeScript lint rules. Production build writes ignored `dist/`; no hosting/deployment is implemented here.

From repository root, `pnpm dev`, `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend` and `pnpm build` delegate to this application. Root normal tests also run backend checks. See [repository layout](../docs/repository-layout.md).

## Future work — not implemented

The scaffold can be extended after product decisions and explicit backend contracts are reviewed. Upload/source retention, processing/progress, review, approval, results, persistence and authentication are future work, not hidden features of this page. They must preserve source/evidence identity and route import effects through the existing backend policies rather than creating a second browser-side importer. No transport, database, workflow engine or runner choice is established by this scaffold. Update this document as those boundaries become implemented; keep plans explicitly labeled until then.

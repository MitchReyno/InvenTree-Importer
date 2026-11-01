# Intake scaffold

React + TypeScript + Vite, managed by the root pnpm workspace. Run `pnpm dev`
from the repository root. This is a local file-name/size preview only. It does
not upload or parse files, call the importer or provide a backend API. No proxy
or vendor/inventory credentials are configured. Selections disappear on refresh.

Frontend-only checks: `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend`
and `pnpm build`. The root `pnpm test` also runs the existing Python tests.
Dependencies live here; the single lockfile and package-manager pin live at root.

# Batch workspace redesign implementation

Maintained implementation handover for [`redesign-batch-workspace`](../../openspec/changes/redesign-batch-workspace/) ([BI-008](../PLANNED_FUNCTIONALITY.md#bi-008--batch-workspace-redesign)). Status: PR-A (Tasks 1–3) in progress on `feat/redesign-batch-workspace-foundation`. Reviews, CI and merges are recorded only after they occur.

## Authority and boundaries

Mitch authorized implementation with `/opsx:apply redesign-batch-workspace` after the plan merged in #94. The normal PR workflow applies: an isolated branch per bundle, independent read-only review of the exact head, then selected green CI. Merging needs Mitch's instruction. No live provider call, real InvenTree request or change to real local data is authorized; browser checks use the owned fake and synthetic content.

Toolchain: the shell default Node 22 and pnpm 8 don't satisfy the pins. Commands run with the nvm-installed Node 24.22.2 (`.node-version`) and pnpm 12.16.1. `pnpm install --frozen-lockfile` in the worktree changed no lockfile before the font packages were added.

Baseline at `8f4a81c`: `pnpm --filter @invimport/frontend test` passed 310/310.

## PR-A plan: foundation (Tasks 1–3)

Scope is the [PR-A handoff](../../openspec/changes/redesign-batch-workspace/handoff-pr-a.md): tokens, themes, fonts, the component library, the sweep onto tokens and masthead option A. Non-goals: no route, data, contract or copy change, except where the handoff names one (the masthead order and the overflow menu holding Agent settings).

### Tokens and theme (Task 1)

| Piece | Location | Notes |
| --- | --- | --- |
| Token source | `frontend/src/theme/tokens.json` | Copy of the design system's file with the handoff's changes: `photo-scrim`, `photo-fg`, dark `part-*`, the "Public Sans Variable" stack |
| Generator | `frontend/scripts/generate-tokens.cjs` | Writes `tokens.css` (`:root, [data-theme="light"]` and `[data-theme="dark"]` blocks with `color-scheme`) and `tokens.ts` (typed `var(--…)` map and type styles). `--check` fails when either file is stale |
| Contrast | `frontend/scripts/check-contrast.cjs` | WCAG relative luminance over a named pair list (text 4.5:1, non-text 3:1), both themes; names each failing pair |
| Literal colours | `frontend/scripts/check-literal-colors.cjs` | Rejects hex, `rgb()`/`rgba()` and `hsl()` in `src/**` outside `src/theme/`, tests and the proof fixtures |
| Theme controller | `frontend/src/theme/theme.ts` | Pure choice/resolve/apply functions, try/catch storage under `bench-intake.theme`, a `matchMedia` listener while the choice is System, and a `useSyncExternalStore` hook for the menu |
| Pre-paint | inline script in `index.html` | Sets `data-theme` before first paint. The app sends no CSP, so the inline script is allowed |
| Fonts | `@fontsource-variable/public-sans` and `@fontsource/ibm-plex-mono` (400, 500), both 5.3.0, OFL-1.1, checked on the registry on 2026-11-06 | Imported once from `GlobalStyle.tsx`, so Vite bundles them locally |

The three scripts are `.cjs` standalone tools per the shared guidelines, run by `lint` in the frontend package so CI's frontend lint job runs them. Their logic is exported and tested with Vitest.

### Components (Task 2)

New components go in `frontend/src/components/ui/`, one per file, each with a test of its states, keyboard behaviour and accessible name. Existing controls keep their behaviour and tests; only their styles move to tokens. `primitives.tsx` keeps all its exports and props.

The sweep maps the current palette onto tokens by role, not by nearest hex: text `#233349` → `fg`, `#526179` → `muted`, borders `#d5dce5` → `line`, blue actions `#164a93`/`#266ac5` → `accent`, pale blue fills → `accent-weak`, warm fills → `warn-weak`, and so on. The light theme therefore takes the design system's values, as the design's compatibility note expects.

### Masthead (Task 3)

One bar in the handoff's order, with an overflow menu (Radix popover) holding Agents, Agent settings and the theme radio group. The current mask and phone dimming move to the handoff values. `finishes.ts` gains light and dark finishes; the scene re-tints materials and fog when `data-theme` changes, observed with a `MutationObserver`, without rebuilding geometry.

### Verification plan

- RED first for the generator check, contrast pairs, literal-colour check, theme switching and storage failures, each new component, and the masthead slot order and phone-width hiding.
- `pnpm typecheck`, `pnpm lint:frontend` (including the three scripts), `pnpm test:frontend`, `pnpm build`, `pnpm lint:readability`, `pnpm format:check`.
- Browser (headless, against the dev stack with the owned fake): a component gallery and the masthead at 1440, 860 and 390px and 200% zoom in both themes; no wrong-theme flash on a dark reload; masthead frame sampling showing no part pixels over the text boxes; the reduced-motion still frame.

## PR-A results

Recorded as each task completes.

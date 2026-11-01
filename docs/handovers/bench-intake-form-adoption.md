# React Hook Form adoption

## Prospective plan

The user approved React Hook Form after comparing it with Formik and TanStack Form. This record precedes dependency and form changes. The coordinator owns the initial Capture editor adaptation; the processing owner retains QuestionAnswer ownership and will adapt it after the shared dependency reaches merged trunk.

Replace repeated field state with a typed form model, native input registration and Controller adapters for the existing composite quantity/reference controls. Preserve styled-components, native constraints and TypeBox/AJV contracts. Do not add a second schema vocabulary or convert exact quantity/identifier strings to numbers.

Keep revision authority, pinned context, navigation guards and stable retry payload/key handling outside the form library. Defaults are captured when an editor mounts for a selected subject; polling must not reset dirty values. Keep synchronous dirty notification in input events, since a later effect cannot protect immediate navigation. Discard remains explicit. Saving and conflict handling continue through the existing owning mutation interface.

Extract capture command construction into a focused typed model module. Do not use form conversion as a reason to rewrite unrelated workspace/media code. Also adapt the new-batch form, extracting its editing/submission responsibility into its own NewBatchForm TSX component. Preserve its payload-bound createIntent key across uncertain acknowledgements and clear dirty state only after confirmed creation or explicit discard. Review the remaining substantive forms after this first adaptation; trivial lookup state may remain local where a form abstraction adds no clarity.

The form adoption is isolated on a focused branch from merged T04 before review. T05 retains matching provisional source changes until it merges the actual form PR; it must not depend on an unpublished sibling branch. Shared media dependencies/grants are excluded.

## Package assessment

Official React Hook Form documentation describes native registration, Controller for composite controlled inputs, and explicit reset/default behaviour. Registry metadata at adoption reports version 7.91.0, MIT, Node >=18, React peer compatibility through React 19, and no runtime dependencies. Pin that exact stable version with the workspace's Node 24.22.2/pnpm 12.16.1. This is a metadata compatibility result; installed type, lint, test and browser checks still need qualification.

- <https://react-hook-form.com/get-started>
- <https://react-hook-form.com/docs/usecontroller/controller>
- <https://react-hook-form.com/docs/useform/reset>
- <https://registry.npmjs.org/react-hook-form/7.91.0>

## Verification plan

Run frontend typecheck/lint/tests and relevant formatting/generation checks. Add meaningful interaction regressions for exact values, composite mode changes, unsaved input surviving a newer snapshot and immediate dirty notification. Existing conflict/navigation tests must stay green. Use browser-harness to inspect actual inputs, native selection, keyboard access and layout against the original references. Independent review must assess the form policy and actual behaviour before merge.

## Results

Implemented CaptureEditor native registration and composite Controller adapters with a separate typed editor model. Extracted NewBatchForm from Batches and retained the payload-bound create intent outside React Hook Form. Added frontend guidelines defining the boundary and reset/dirty/retry rules.

The isolated worktree's frozen offline install, frontend typecheck, ESLint, 13 component tests, production build and changed-file Prettier/diff checks pass. The two new interaction tests cover synchronous dirty events, newer-snapshot draft retention, explicit quantity/location modes and identical payload/delivery keys after lost acknowledgement. Existing conflict/navigation/exact-decimal tests remain green.

Vite reports its standard >500 kB chunk advisory: the minified entry is 521.45 kB (159.68 kB gzip). This change does not suppress the advisory or claim a performance measurement.

The former T04 preview's recorded PIDs and port are no longer live in the refreshed elevated process/listener check. Its retained metadata, files and database are preserved. A short isolated browser fixture will reuse the existing PostgreSQL service after the query owner's allocated heavy checks; no duplicate preview has been started. Browser evidence and independent review remain pending.


## Independent review correction

The fresh reviewer rejected head 148f772 with one P2. Although repeated retries in the mounted form retained the key, extracting createIntent into NewBatchForm shortened its lifetime. After a lost create acknowledgement, discard/reopen could send identical data with a new key. The reviewer's adverse interaction failed this head and passed the original T04 implementation.

The correction keeps createIntent and the payload-bound create command in Batches, which outlives the mountable editing form. NewBatchForm receives the create operation and owns only editing/submission presentation. The tracked regression now submits, retries, discards, reopens and submits identical data, asserting the original key throughout. All 13 frontend tests pass after the correction. Independent re-review and actual browser checks remain pending.


## Final qualification

The independent reviewer cleared corrected code at 4b75175 and the actual rebuilt browser runtime at ad43bfc. A normal merge incorporated actual query-uplift trunk a1e1c18; the frontend diff across that merge is empty. Independent typecheck, ESLint, 13 frontend tests, formatting and the original discard/reopen adverse probe pass. The coordinator's full frontend/contracts/server typecheck and production build pass too.

The short browser fixture used the sole retained local PostgreSQL service with a new randomized database/restricted role and fake GET-only inventory endpoint. Older preview processes were confirmed absent; their retained namespaces were untouched. No new PG service, real inventory operation, apply worker, provider credential or inference was involved. The capture-only fixture does not grant manual activity access, so its Activity unavailable banner is expected and is not product-wide activity qualification.

Native browser interactions verified retained new-batch creation and human note, required title, quantity modes, rejection of exponent text, exact 9999999999999.999999 save and reload, dirty Batches/Resume links, real history Back, explicit discard and desktop/narrow layout. All five screenshots were visually inspected:

- [Desktop dirty navigation](../bench-intake/evidence/forms/desktop-dirty-navigation.png).
- [Narrow conflict preservation](../bench-intake/evidence/forms/narrow-conflict-preserved.png).
- [Narrow exact quantity](../bench-intake/evidence/forms/narrow-exact-quantity.png).
- [Desktop saved exact quantity](../bench-intake/evidence/forms/desktop-saved-exact-quantity.png).
- [New batch dirty navigation](../bench-intake/evidence/forms/new-batch-dirty-navigation.png).

The observed 412 was incidental, not a deliberately injected conflict fixture. Read-only retained history identified archive/resume commands before the exact quantity save; pre-instrumented native actions could not be attributed more precisely. The exact quantity save itself succeeded as revision 4 and survived actual reload. Existing component conflict tests remain an independently reproduced controlled conflict case.

No remaining material finding was reported. Final documentation/evidence changes and selected exact-head CI still require the normal merge gate. Processing and media form adaptations remain their owners' follow-ups after this dependency merges; this PR does not claim their completion.

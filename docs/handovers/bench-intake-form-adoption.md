# React Hook Form adoption

## Prospective plan

The user approved React Hook Form after comparing it with Formik and TanStack Form. This record precedes dependency and form changes. The coordinator owns the initial Capture editor adaptation; the processing owner retains QuestionAnswer ownership and will adapt it after the shared dependency reaches merged trunk.

Replace repeated field state with a typed form model, native input registration and Controller adapters for the existing composite quantity/reference controls. Preserve styled-components, native constraints and TypeBox/AJV contracts. Do not add a second schema vocabulary or convert exact quantity/identifier strings to numbers.

Keep revision authority, pinned context, navigation guards and stable retry payload/key handling outside the form library. Defaults are captured when an editor mounts for a selected subject; polling must not reset dirty values. Keep synchronous dirty notification in input events, since a later effect cannot protect immediate navigation. Discard remains explicit. Saving and conflict handling continue through the existing owning mutation interface.

Extract capture command construction into a focused typed model module. Do not use form conversion as a reason to rewrite unrelated workspace/media code. Also adapt the new-batch form, extracting its editing/submission responsibility into its own NewBatchForm TSX component. Preserve its payload-bound createIntent key across uncertain acknowledgements and clear dirty state only after confirmed creation or explicit discard. Review the remaining substantive forms after this first adaptation; trivial lookup state may remain local where a form abstraction adds no clarity.

## Package assessment

Official React Hook Form documentation describes native registration, Controller for composite controlled inputs, and explicit reset/default behaviour. Registry metadata at adoption reports version 7.91.0, MIT, Node >=18, React peer compatibility through React 19, and no runtime dependencies. Pin that exact stable version with the workspace's Node 24.22.2/pnpm 12.16.1. This is a metadata compatibility result; installed type, lint, test and browser checks still need qualification.

- https://react-hook-form.com/get-started
- https://react-hook-form.com/docs/usecontroller/controller
- https://react-hook-form.com/docs/useform/reset
- https://registry.npmjs.org/react-hook-form/7.91.0

## Verification plan

Run frontend typecheck/lint/tests and relevant formatting/generation checks. Add meaningful interaction regressions for exact values, composite mode changes, unsaved input surviving a newer snapshot and immediate dirty notification. Existing conflict/navigation tests must stay green. Use browser-harness to inspect actual inputs, native selection, keyboard access and layout against the original references. Independent review must assess the form policy and actual behaviour before merge.

## Results

Pending implementation and qualification.

# T06 exact uncertain-answer retry

## Prospective plan

Prepared before implementation at checkpoint `fe245a3`. Own only `QuestionAnswer.tsx`, `ProcessingQuestions.test.tsx` and this record. The coordinator retains parent workspace, contracts and shared integration ownership; the Processing owner is diagnosing a separate PostgreSQL test failure. Preserve all concurrent changes and coordinate the Git index before staging.

The current form keeps only a fingerprint/key. After a lost acknowledgement, polling can mark the pinned question answered, missing or replaced and advance capture revision; stale gating then prevents adoption of the original receipt. Editable uncertain fields can also silently replace the original request identity.

Keep the first validated question ID, exact typed payload and delivery key until confirmed save or explicit local discard. Freeze fields after a send remains unconfirmed. Explicit retry uses only that captured delivery even when the question context moves; it does not authorize a fresh stale submission. Preserve TypeBox validation, React Hook Form field/submission ownership, exact scalar strings, synchronous dirty reporting and the stable mounted question.

Parent inspection confirms that `ProcessingWorkspace.perform` still requires the same mounted server scope, a current successful read, a nonarchived batch and no in-flight command. It does not reject a moved question/capture context itself. No parent change is needed. Existing disabled/read-only gates also apply to exact retries; read failure is not new command authority. Explicit discard remains available when fields are read-only and clears only local intent, not a possibly saved server answer.

First reproduce stale-context retry and uncertain-field failures through component interactions. Cover answered/missing/replaced polling, original payload/key, first stale-send refusal, unavailable/archive refusal and explicit discard. Then implement the focused lifecycle correction and run focused/full frontend tests, types, lint/readability, formatting and Markdown checks. Do not build assets, start services or invoke providers; native browser/whole-feature review remains separate.

No new package, schema, backend or form framework is needed. Existing React Hook Form owns field state; the captured delivery remains domain state outside the form cache. All tests use deterministic in-process stubs. The original InvenTree is strictly read-only; no model/provider usage, credentials or inventory request is part of this task.

## Implemented behavior

`QuestionAnswer` captures a frozen validated answer, original question ID and delivery key before the first send. Pending and unconfirmed fields stay disabled. Retry sends only that captured delivery; it bypasses stale question/capture context, while disabled/read-only command gates still apply. No automatic retry was added.

Confirmed delivery clears the captured intent, form and navigation guard. Explicit discard does the same locally, with copy explaining that it cannot undo a possibly saved answer. Invalid or first stale submissions never acquire a delivery identity. Polling never rebases the mounted editor.

The parent command gate was inspected without changes. `ProcessingWorkspace.perform` still enforces current mounted scope, successful fresh read, nonarchived batch and idle command state. This component change grants no authority during unavailable reads or archive state.

## Regression evidence

Tests were added before the runtime correction. Against the original component, the focused file produced **5 failures / 6 passes**: answered/missing/replaced polling blocked receipt retry, uncertain fields stayed editable, and the exact-retry lifecycle was absent.

After correction:

- Focused component tests: **11 passed**.
- Full frontend suite: **86 passed across 16 files**.
- Frontend TypeScript check and frontend ESLint: passed.
- Targeted shared readability ESLint, Prettier and diff whitespace check: passed.
- This handover's Markdown lint: passed.

Coverage includes a poll-style rerender with answered, missing and replaced questions plus capture revision advancement; original exact scalar payload/question/key reuse; frozen native inputs and forced field changes; stale first-send refusal; disabled/read-only forced-submit refusal; confirmed-save guard clearing; and explicit discard followed by a new delivery key.

All command boundaries are deterministic in-process mocks. These are jsdom component proofs, not browser, HTTP, database or server receipt proofs. No services, providers, models, credentials or inventory requests were used. Asset builds and whole-feature independent review remain with the coordinator. Validation ran on the shared working tree; unrelated concurrent files were preserved.

## Integration checkpoint

Only the component, focused test file and this handover belong to this correction. The coordinator inspected the component delta and granted an exclusive Git index checkpoint for these three paths. The focused correction is committed separately; whole-feature/native review remains pending. Parent, schema, backend and other Processing changes remain under their existing owners.

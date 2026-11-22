# Implementation and delivery tasks

## Plan context

- Change: `bound-agent-evidence-images`, BI-018. See the [proposal](proposal.md), the [design](design.md), and the spec deltas for `processing-agent-sessions` and `shared-vm-execution`.
- Reuse: the existing `sharp` 0.35.5, with no new dependency.
- Every branch and commit/PR subject includes `bound-agent-evidence-images`.

## Completion and commit ordering

Check an action off only after it is done and verified, in the same commit as the work. Review, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Plan and BI entry | Planning | None | Proposal, design, specs and tasks validate; BI-018 is in the index |
| 2. Bounded deliveries in the tool server | Behavior | None | processing-agent-sessions › Bounded agent evidence images |
| 3. Guest staging of the delivered image | Behavior | 2 (contract field) | shared-vm-execution › Guest-staged evidence matches the delivered image |
| 4. Provider error capture and record | Behavior | None | processing-agent-sessions › Categorized failures with diagnostic disclosure |
| 5. Guest frame and panel | Behavior | 4 | shared-vm-execution › Guest-reported provider error; the panel scenarios |
| 6. Live check | Qualification | 2–5 merged; Mitch's go-ahead | The live row of the design's verification table |

## PR delivery map

| Bundle | Outcome | Tasks | Why this boundary | Order | Branch and subject | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | Agents only ever receive bounded images | 1, 2, 3 | One contract field (`delivered`) and its two consumers ship together; the fix for the image failure | First | `feat/bound-agent-evidence-images`, `fix(bound-agent-evidence-images): bound every image sent to agents` | Fast, PostgreSQL and process tiers; GPT-6.2 Sol review; CI |
| PR-B | A failed turn names the provider's error | 4, 5, 6 | Independent of image bounding; frame and contract change together; includes the visible panel row | After PR-A | `feat/bound-agent-evidence-images-provider-error`, `feat(bound-agent-evidence-images): record the provider's turn error` | As PR-A, plus a demo recording of the panel and the live check |

## 1. Plan and BI entry

- **Outcome:** the change is planned, and BI-018 links to it.
- **Verification:** `openspec validate bound-agent-evidence-images`; `pnpm format:check` on the changed Markdown.

- [x] 1.1 Write the proposal, specs, design and tasks, and validate them.
- [x] 1.2 Add BI-018 to `docs/PLANNED_FUNCTIONALITY.md` under Fixes › High.

## 2. Bounded deliveries in the tool server

- **Outcome:** every `fetch_evidence` image comes from the decoded preview, is at most 2,576 px on its long edge, and is described by `delivered`. No original upload bytes are sent.
- **Scope:** `contracts/src/sessions.ts` (`delivered`); `intake-server/src/agents/tools/handlers.ts` (remove the original branch, bound whole pages and regions); `intake-server/src/media/region-crops.ts` (a bounded size); `intake-server/ARCHITECTURE.md` where it describes evidence delivery.
- **Approach (TDD):** write the handler tests below against the current code and see them fail, then implement.
- **Verification:**
  - the intake-server fast tier, and the contracts tests;
  - the PostgreSQL-tier handler tests (`tests/pg/session-*.test.ts` that fetch evidence);
  - `tests/process/sessions.test.ts`.
- **Risks:** lot sessions now need a decoded preview, which is covered by a refusal test.

- [ ] 2.1 Add `delivered` to `SessionToolResult`, with contract tests.
- [ ] 2.2 RED: write handler tests for:
  - [ ] 2.2.1 a 6144 × 8160 whole page in a lot session, which gets 1940 × 2576 JPEG with scale and digest, and `source` naming the original;
  - [ ] 2.2.2 a region larger than the bound, which is scaled to fit; and a small region, which stays PNG at scale 1;
  - [ ] 2.2.3 the Examine overview, which stays at 768 px with `delivered`;
  - [ ] 2.2.4 a version with no preview, which is refused with no delivery grant;
  - [ ] 2.2.5 the image never being the original upload's bytes.
- [ ] 2.3 Add the bounded crop size to `regionCropCache`, with a separate cache key, and a test.
- [ ] 2.4 Merge the original branch into the preview path, and bound and encode as the design says; GREEN.
- [ ] 2.5 Update the intake-server architecture text on evidence delivery.

## 3. Guest staging of the delivered image

- **Outcome:** the guest stages exactly the delivered image and checks it against `delivered.sha256`.
- **Scope:** `intake-server/src/agents/shared-vm/stage-evidence.ts` and its tests.
- **Verification:** `stage-evidence` unit tests; the fast tier.

- [ ] 3.1 RED: write tests for a match that stages with `local_file` describing the delivered image, and a mismatch that throws `invalid_evidence_file`.
- [ ] 3.2 Check against `delivered.sha256`, and drop the original-only special case; GREEN.

## 4. Provider error capture and record

- **Outcome:** a failed Claude or Codex turn retains `provider_error` with an allowlisted kind, result type and HTTP status.
- **Scope:**
  - `contracts/src/session-failures.ts` (`provider_error`);
  - `intake-server/src/agents/failure-model.ts` (the lists, and the copy into `SessionFailure`);
  - `intake-server/src/agents/session/session-adapters.ts` (capture);
  - the fake CLIs in `intake-server/tests/support`.
- **Verification:** contract tests; the adapter tests in the fast and process tiers.

- [ ] 4.1 Add the optional `provider_error` to `SessionFailure`, with contract tests for its presence and absence.
- [ ] 4.2 RED: write adapter tests in which:
  - [ ] 4.2.1 Claude has `error: 'invalid_request'` and result `error_during_execution`;
  - [ ] 4.2.2 Codex has `codexErrorInfo: 'contextWindowExceeded'`, and `{ httpConnectionFailed: { httpStatusCode: 503 } }`;
  - [ ] 4.2.3 unlisted values become `unknown` or `null`.
- [ ] 4.3 Capture the kinds in both adapters, carry them on `NativeSessionError`, and validate and copy them in `sessionFailure`; GREEN.

## 5. Guest frame and panel

- **Outcome:** VM turns report `provider_error` to the host, and the diagnostic panel shows it.
- **Scope:** `native-outcome.ts`, `guest-turn.ts`, `coordinator.ts`; `frontend/src/components/agents/SessionFailureDetails.tsx` and its test; the frontend fixtures.
- **Verification:** the shared-VM unit and process tests; frontend typecheck, lint, tests and build; a demo recording of the panel.

- [ ] 5.1 RED: write tests for the guest final frame carrying `provider_error`, for host validation turning unlisted values into `unknown`, and for a journal settle having none.
- [ ] 5.2 Carry the field through `nativeTurnOutcome`, the final frame and the coordinator; GREEN.
- [ ] 5.3 Show the provider error in `SessionFailureDetails`, with tests for its presence and absence.

## 6. Live check

- **Outcome:** a VM lot session fetching a 6144 × 8160 original succeeds, and a failing turn shows its provider error.
- **Prerequisites:** PR-A and the code from tasks 4 and 5 are on a runner image, and Mitch gives the go-ahead for provider use.
- **Verification:** a summary of the session outcomes on PR-B.

- [ ] 6.1 Ask Mitch for the go-ahead.
- [ ] 6.2 Run the check, and record the outcomes in `notes.md` and on PR-B.

## Delivery

- [ ] PR-A: exact-head review clean; CI green; merged.
- [ ] PR-B: exact-head review clean; CI green; merged.

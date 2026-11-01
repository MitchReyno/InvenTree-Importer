# Shared intake spike fixture and message contract

## Scope and ownership

This change prepares the shared inputs and provisional messages for the three parallel investigations: subscription runtimes, durable coordination and importer supervision. The initial implementation was completed directly by the main agent, as requested; no subagent was used for implementation. The branch is `feat/spike-shared-contracts`, based on the merged repository restructure on `interactive-app`. Subsequent independent review, correction and clean re-review are recorded below. Publication targets `interactive-app`; no merge is authorized.

## Result and decisions

- Keep the investigation under `spikes/shared/`, outside both application runtimes. Root architecture and README point to its scope and check command. This avoids making a production API or scheduler decision before the investigations provide evidence.
- Use JSON Schema Draft 2020-12 as the language-neutral message definition. The backend development environment supplies `jsonschema>=4.26,<5` and its locked dependencies; the shipped importer gains no runtime dependency. A major-version bound limits unreviewed validator changes; revisit it when adopting a future major version.
- Use original, explicitly synthetic packet PNGs and a PDF receipt. Two physical lots share one Part, with an unresolved current count for the opened packet. This exercises image/PDF reading, durable clarification, a new input revision and preservation of stock contribution identities without private evidence or real inventory.
- Bind manifests and referenced evidence to exact SHA-256 digests. The resumed attempt has a new identity and manifest; a human answer remains correlated to the original question revision. Domain contribution identities and source reference remain stable across attempts.
- Separate request, event, question, answer and result messages. Status-dependent fields prevent a successful result from also carrying pending questions or an error reason. Explicit login, capacity, interruption and failure examples give the coordinator common outcomes to exercise.
- Keep authorization outside the message payload. Listed capabilities require enforcement by the consumer; there is no inventory-write capability or approval token. A validated successful result is a proposal requiring manual review, not evidence of server mutation.
- Validate the expected v2 stock proposal with the actual importer parser and validator and an isolated synthetic category vocabulary. Retain two contribution IDs and their existing idempotency keys rather than inventing another identity scheme.
- Document application acceptance rules separately from schema shape checks. Stale-result rejection, question persistence, authenticated answers, deduplication and transactional dispatch remain work for the spikes. Relative path syntax does not replace filesystem containment or symlink checks.

## Work performed and evidence

1. Confirmed the merged restructuring base and created an isolated feature worktree, preserving the user's existing checkout and untracked installations.
2. Read shared and application guidance and inspected the importer interchange format, validation entry points and synthetic demo vocabulary.
3. Authored the fixture manifests, original visual evidence, expected proposal, example transcript and independent terminal outcomes. Rendered the PDF and visually inspected it and both PNGs for legibility and clipping. Marked fixture PDFs as binary in local Git attributes: their cross-reference records contain meaningful trailing spaces and must retain exact bytes rather than receive text whitespace cleanup.
4. Defined the versioned message schema and added positive and negative conformance checks, artifact digest checks, question/attempt correlation checks and real importer validation.
5. Added `pnpm spikes:check`, the development-only validator dependency and lockfile entries, and root documentation links. No provider runtime, database, frontend or importer execution behavior was changed.
6. Ran the focused conformance checks and backend lint, then the normal suite. Sandbox restrictions initially prevented existing loopback demo tests from starting; the suite was rerun with loopback access. A separate offline-cache issue affected existing crop subprocess tests, requiring Pillow and NumPy in the task-local uv cache. These environment adjustments changed no project code or tests.

## Validation

- `pnpm spikes:check`: 35 passed. This includes invalid fields/capabilities, traversal and newline-suffixed identifiers/paths, contradictory outcomes, byte-bound artifacts, revision correlation and real importer compatibility.
- `pnpm lint:backend`: passed.
- `pnpm test`: passed; 2 frontend tests and 1,943 backend tests, with 1 existing skip and 43 scanner/TUI tests deselected. Backend duration was 194.19 seconds. Scanner/TUI behavior is unchanged, so the separately opted-in scanner suite is outside this change.
- `git diff --cached --check`: passed after classifying the fixture PDF as binary. Changed Markdown links and portable paths were checked; the rendered receipt and packet PNGs were visually reviewed.
- Before the successful full run, an offline run reported 24 crop-test failures and 1,916 passes because the separate `uv run --with pillow --with numpy` cache was empty. After populating that owned cache, all 24 crop tests passed in isolation and the full suite passed. The earlier sandbox-restricted loopback run was interrupted after its environment limitation was reproduced. Neither failed attempt was treated as coverage or fixed by weakening assertions.

## Independent review correction

A fresh read-only reviewer checked implementation `a4e16686a4c6f563a9dc28aefd94481af5dedf77` against `interactive-app` and found one material portability defect: `core.autocrlf=true` converted the byte-hashed JSON fixtures to CRLF on checkout, invalidating the retained manifest and proposal digests. The reviewer ran the 35 focused tests, 220 additional adversarial schema probes, changed-Python lint, an offline lockfile check and whitespace checks; no other material findings were confirmed. This is reviewer evidence, not a full-suite or provider-runtime rerun.

The correction adds a scoped `text eol=lf` attribute for fixture JSON files. It preserves their committed bytes and existing digests across checkout policies rather than normalizing bytes during integrity validation or changing the protocol. The PDF remains binary. Coordinator validation passed all six checkout-filtered byte/hash probes with `core.autocrlf=true` and `false`, the 35 focused tests and whitespace checks. No fixture contents, message revisions, importer behavior or provider capabilities change.

Independent re-review cleared the corrected two-file working diff on the original implementation HEAD with no material findings. It independently passed the same six probes, three more with `core.eol=crlf`, PNG/PDF byte-preservation checks, scoped attribute checks, 35 focused tests, focused Python lint and whitespace checks. The reviewed diff digest was `8ce363bca8cc93d81144d761347ce04fd5d24467adcab73f556e00ffb4432158`; this clearance record is a subsequent documentation-only update. The full suite and provider runtimes were not rerun for the line-ending-only correction. Spike branches initially based on the original shared commit must inherit this correction before publication; no contract or fixture digest revision is needed.

## Consumer handover

Read [the shared contract guide](../../spikes/shared/README.md) and run `pnpm spikes:check` after installing the locked development dependencies. Provider owners stage only the selected manifest and its evidence, withholding the expected proposal oracle. Coordinator owners replay the transcript and exercise acceptance/restart/conflict behavior against their real persistence boundary. Importer owners use the proposal and synthetic vocabulary with an owned fake target and preserve the engine's execution ownership and uncertainty rules.

The fixture is deliberately small and partly prestructured; it tests integration mechanics rather than proving broad OCR, identification or component research quality. Add realistic evaluation cases separately once provider execution works. The illustrations are not photographs and the receipt is not a real purchase. Never run this fixture against real inventory. Reconcile the provisional protocol after the independent spikes and before production adoption; an incompatible contract change requires a new protocol version and matching examples.

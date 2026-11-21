# Stage 1E — retained observation to canonical execution

Repository-only command-side investigation, not a production service or a language/framework decision. The exact outer protocol is `bench-intake-spike/1`. Research replays the retained Codex observation under `spikes/subscription-runtime/observed/`; no inference, native permission reply, login inspection or credential copying is permitted. The shared evidence is fictional, but the retained proposal was actually provider-produced. It lacks the oracle's SKU, description and receipt attachment; validation warnings and those omissions must survive execution.

## Proof cases fixed before implementation

- Original input/evidence bytes and retained provider proposal pass the actual importer; changed bytes fail before acceptance. The expected proposal is never the accepted proposal.
- Replay actual retained outer progress/question/result; persist the question and finish its DBOS command, allowing an unrelated serial command to finish before the answer. An authorized command principal answers; the transaction creates a different immutable input/attempt. Wrong principal, old question/input/attempt, changed payload/runtime and stale results cannot replace selected human facts.
- PostgreSQL commits the exact selected approval, immutable apply command and outbox together. Kill real processes after approval commit, after DBOS enqueue before ACK, after canonical reservation and after engine result before application publication. Recover the original identity/run or recovery-required, without a fresh namespace.
- Exercise a surviving serial apply child, accepted-request cancellation, dropped progress and canonical projection recovery, applied-but-lost stock/attachment ACKs and supported selected repair. Original source/contribution/Part identities survive later lot rounds; unresolved prior ownership blocks later writes.
- Distinguish retained provider observation replay, authored adverse controls, real PostgreSQL/Django/DBOS and real SDK/persistent fake. Do not count mocks, opt-in skips or native-unrun paths as execution proof.

## Reproduce

Use the declared Python 3.12 environment and PostgreSQL 14+ binaries on PATH (the owner used 17). From repository root:

```sh
uv sync --project spikes/combined-seams --locked
uv run --project spikes/combined-seams --locked python spikes/combined-seams/probe.py --state .temp/combined-seams-new
uv run --project backend pytest backend/tests/spikes/test_combined_seams.py backend/tests/spikes/test_shared_contracts.py
uv run --project backend ruff check --config backend/pyproject.toml spikes/combined-seams backend/tests/spikes/test_combined_seams.py
```

The probe refuses an existing state path and creates/stops only its own PostgreSQL cluster and loopback fake listeners. All private database/workflow/fake/canonical state is retained. Use a new path for each run. No existing database URL is accepted. The command-side allowlisted principal is not browser/session/HTTP authentication. Native Stage 1A policy/billing/restart, browser/SSE, restore, Windows and live-target compatibility remain unproved.

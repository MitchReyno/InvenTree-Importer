# Importer adapter investigation (Stage 1C)

Repository-only Python experiment using the actual installed InvenTree SDK and existing durable stock engine, with a private persistent loopback HTTP fake. There is no Django endpoint, provider invocation, production apply service or inventory authorization in this directory. Use only synthetic owned workspaces. Never point this fixture at real inventory.

Run from the repository root with the backend development dependencies installed:

```sh
uv run --project backend pytest backend/tests/spikes/test_importer_adapter.py -vv
uv run --project backend ruff check --config backend/pyproject.toml backend/src/invimport/execution/adoption.py backend/src/invimport/execution/ownership.py backend/tests/spikes/test_importer_adapter.py spikes/importer-adapter
bash spikes/importer-adapter/state.sh
```

The tests are the reproducible experiment driver: each creates a new synthetic owned workspace, retains fake records/consumed faults/engine state across actual child processes, and restarts the listener at its original port for selected repair. `--basetemp NEW_DIRECTORY` can retain their workspaces for investigation; use a new disposable directory because pytest clears that destination on a later run. Never use an existing demo, import, execution state directory or backup as pytest's base directory.

## Boundaries

- `adapter.py` materializes the selected v2 lots before expansion, validates through the actual importer, adapts synchronous company/Part choices, prepares a complete effect closure and persists explicit synthetic approval intents before dispatch. Plans embed approved evidence bytes. Approval records bind Plan.revision, serialized-plan SHA, input/proposal/config byte hashes, target, fake database nonce, selected scope, state binding and actual importer/adapter source plus dependency-lock build digest. They are private trusted fixture records, not signed authorization tokens.
- `questions.py` persists shared `bench-intake-spike/1` question/answer envelopes with schema validation and exact input-byte revisions. Missing decisions raise `WaitingForAnswer` and release preparation's lock. Offered choices, candidate data, scope and local planning revision fingerprint questions; changed inputs do not consume old choices. Answers are allowlisted and conflicting/obsolete answers reject. Authentication and application outbox/continuation transactions belong to the coordinator/application spike, not these local files.
- `supervisor.py` starts one isolated SDK child using the existing demo's credential/proxy/home/state allowlist. `apply.lock` excludes duplicate children; the engine's canonical claim remains authoritative. The cancellation pipe stops new work at engine boundaries; stdin EOF also requests cancellation. Accepted remote requests are not undone. A wait timeout leaves the same child owned and inspectable; it never launches a replacement.
- `worker.py` bridges native Observation records using nonblocking 4096-byte Unix datagrams. Delivery is lossy and observer exceptions do not control effects. Events are not shared job messages, durable SSE cursors or an executable journal. `snapshot()` uses a fresh child and the public canonical inspection/status API, without connecting to the fake server. The engine still retains its own invocation observations in memory; only IPC/backpressure is bounded here.
- `fake_server.py` adds persisted one-shot successful-application acknowledgement loss and delayed acknowledgements to the existing reviewed persistent demo fake. Production HTTP/engine policies are unchanged. The fake's private SQLite SQL is not inventory ownership SQL.

## Start, adoption and recovery

`start_or_adopt` always inspects the canonical binding at the deterministic approval directory before connecting or executing. A matching initialized run is adopted read-only, including a completed historical run after another approval round. An existing incomplete run is not implicitly resumed. A reservation without a usable journal requires recovery; it cannot fall through to execute. A different unresolved same-source claim prevents a later write round. Engine execute/repair still acquire their normal registry/journal/claim locks, so inspection is not a lease.

Selected repair passes the original Plan, run, operation and journal to `repair_stock`, with an explicit continuity-review reason. Uncorrelated unknown stock creation remains review/uncertainty, even when the fake contains a stock record. Attachment acknowledgement loss uses the supported filename/target/content verification path and never blindly uploads again. The earlier unknown attempt remains in canonical history. No generic retry, abandoned-claim reset, new source identity, new state root or legacy fallback exists here.

Version 2 shared Parts permit selecting lot B alone: filtering the raw interchange first avoids its parser-generated same-document `part_of` reference to unselected lot A. A later round explicitly binds the original known Part PK/IPN and revalidates that identity before preparation. v1 `part_of` selections are rejected by this spike; including their parent as a whole lot would expand approval. This is a deliberate unsupported adapter case, not an engine rewrite or a claim that arbitrary `part_of` dependency extraction is solved.

See the [engineering handover](../../docs/handovers/spike-importer-adapter.md) for rationale, fault evidence, limitations and the independent-review gate. Shared contracts/fixtures and root documentation remain coordinator-owned.

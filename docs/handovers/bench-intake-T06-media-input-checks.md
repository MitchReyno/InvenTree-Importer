# T06 owning media-input PostgreSQL checks

## Prospective test plan

Prepared before test implementation on the actual-media merge checkpoint `d647938`. The coordinator owns the media/capture APIs and the Processing owner owns consumers and migration 0007. This test owner changes only `intake-server/tests/pg/media-input-scopes.test.ts`, a focused test helper if needed, and this handover. Other edits and the shared Git index remain untouched.

Use existing `isolatedDatabase` and `seedAuthority`, public Capture creation and deterministic synthetic media metadata. The metadata fixtures exercise authorization, exact descriptors, locks and pins; they do not qualify decoder pixels, blob readability, inference or inventory effects. No additional dependency, service or runtime implementation is needed.

1. Read scoped descriptors in a caller-owned repeatable-read READ ONLY transaction. A concurrent public unlink must complete without waiting, while the original reader retains its snapshot and a new reader sees the changed scope. Reject foreign actors, batches and subjects.
2. Distinguish ready, pending and over-capacity closures. Bulk read results must preserve an unaffected scope when another is blocked. Bulk commands remain all-or-nothing, including a union exceeding 64 versions when each individual scope is supported.
3. Block the highest digest and request its scope before a lower-digest scope. Inspect actual PostgreSQL waiting/held locks to prove the global sorted union, then release it and verify genuine handles pin only their expected per-scope sets, including an empty set.
4. Verify historical retained binding bytes, complete pins and immutable version facts. Refuse absent, corrupt and foreign bindings without manufacturing authority. Use independently expected IDs/digests and correctly hashed semantic corruptions where useful.
5. Provision the narrow reader and capture-row-lock grants. Read/settlement locks must work, including archived settlement when implemented; new archived work, human edits, media writes and pin insertion must remain denied.

Use bounded polling and always roll back/release clients, close temporary role pools, drop owned roles and dispose only the random fixture database. Request the serialized PostgreSQL allocation after code is ready and migration 0007 is frozen. Run focused tests, a discriminating negative control through coordinator-owned runtime mutation if authorized, type/format checks and final changed-file inspection. Record observed results separately from pending gates.

## Restrictions

The original repository environment's real InvenTree is strictly read-only; no calls or mutation probes are part of these checks. Do not discover the original environment or copy personal inventory/provider credentials. No actual model/provider test or usage is permitted; fixtures and stubs only. Do not start Docker, another PostgreSQL service or a browser. Preserve the existing Capture preview and all other worktrees. Stage and commit only owned files after the coordinator reserves the shared index.

## Current status

The seven-case suite is implemented and qualified against fresh owned PostgreSQL namespaces. The test allocation has been released. Whole-feature integration and independent review remain coordinator gates.


## Implemented checks and observed results

The new test file uses the focused `tests/support/media-input-scopes.ts` helper. Public Capture creation establishes real native lineage; known 1px PNG inputs and explicitly synthetic `owned-scope-metadata/1` rows establish metadata for scope/lock tests. No BlobStore, decoder worker or content reader is initialized. These checks do not qualify pixels, retained object bytes or provider media access.

| Boundary | Observed result |
| --- | --- |
| Read-only snapshot | Concurrent public unlink commits without read-side exclusion; the original snapshot retains identical bytes and a new snapshot sees the new scope. Foreign actor/target/context/batch and an actual other-batch lot are refused. |
| Per-closure blockers | Ready and exact-empty closures remain available beside pending and 65-version closures. A 101-scope bulk read is refused. Over-capacity command reservation retains no binding. |
| Byte capacity | The same 64 versions fit one subject but exceed the published 256-KiB budget when their 100 authorized subject links are in scope. The narrow closure remains ready beside the blocked broad closure. |
| Bulk retention | A combined 65-version union produces exact 32-version, 33-version and empty handles. Each command retains only its independently expected subset; the empty command retains its own binding. |
| Global digest order | A high-first requested scope blocks at the deliberately held highest digest only after the lower digest is visibly held in PostgreSQL. No binding is published while blocked. |
| Retained authority | Exact reads succeed. Missing bindings, missing/extra pins, a real other-batch command lookup and correctly hashed false immutable evidence identity are refused without repair. |
| Narrow role | Descriptor/binding reads and live/archived settlement row locks work. New archived work is refused; human labels/titles/notes/selections, media writes and pin insertion remain denied. A changed subject identity hits the immutable-identity guard. |

The final complete run passed **7/7**, with zero failures or skips, in 13.79 seconds. Server typecheck passed. The earlier six-case run and first expanded seven-case run also passed; the final run includes the strengthened same-database foreign-scope checks.

Run from repository root with the pinned toolchain and existing private owned service helper:

```sh
node intake-server/scripts/run-media-pg.cjs '' inputs
pnpm --filter @invimport/intake-server typecheck
```

The helper supplies a narrow synthetic database environment; it never starts or restarts a service or discovers the repository environment. Every case rolls back/releases clients and drops its own random database. The narrow reader fixture closes its role pool, drops only its owned grants/role and then disposes its database. Successful final cleanup released the coordinator allocation. Shared PostgreSQL and the retained Capture preview were untouched.

## Discriminating lock-order control

The coordinator temporarily reversed only the global digest acquisition loop in its owned `media/locked-inputs.ts`. The selected global-union case failed at the intended assertion: the low digest lock was absent while the high digest was blocked. This is actual database exclusion evidence, not a helper-call-order expectation.

The coordinator restored the exact source in a `finally` block. Before/after SHA-256 was `305cc67725eb5df1626c379c0bd51899a756c5fae80762f6661be4e55d5efb0e`; the selected restored case passed 1/1 with zero skips. The local ignored receipt is `.temp/media-input-control-f96f0ae7e1694b8dae758f17aadeeb26/receipt.json`. Its logs and original source remain local evidence, not a checkout dependency. This test owner did not edit runtime source.

## Limits and next owner

These are owning-interface tests against the combined working-tree APIs, not an independently releasable test-only change, independent whole-feature review or native browser qualification. The coordinator-owned API edits and Processing consumer work remain separate checkpoints on the same preserved feature branch. The coordinator separately reran the existing eight media-retention cases. Processing continuation, physical runner/cancellation behavior and end-to-end provenance remain the Processing owner's separate checks. No actual model/provider, real inventory, personal credential, browser, Docker or decoder operation occurred in this task.

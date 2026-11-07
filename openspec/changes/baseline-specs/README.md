# baseline-specs

Baseline specs for behavior built before OpenSpec, plus the documents and spikes they came from. Read the [proposal](proposal.md), the [design](design.md) and the [tasks](tasks.md). [coverage.md](coverage.md) maps every section of every source to where it went.

- `specs/`: `ADDED` deltas for new capabilities only, checked against the code. Once synced, `openspec/specs/` is the current statement of these behaviors.
- `sources/`: the original design and plan documents, moved here unchanged apart from link repairs. They are historical: where they disagree with the specs or with later changes, the specs and later changes win.
- `spikes/`: the Stage 1 investigation code (`combined-seams`, `durable-coordination`, `importer-adapter`, `subscription-runtime`, `shared`) and their former backend tests in `spikes/tests/`, preserved as written. They no longer run in the normal suite and their paths assume the old layout. To rerun one, check out the `history/pre-openspec-cleanup` tag, where they run as committed.

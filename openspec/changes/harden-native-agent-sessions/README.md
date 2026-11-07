# harden-native-agent-sessions

Confine native Claude and Codex agent sessions to the intake tools, make proposal validation and mid-session evidence usable by real models, and re-run the live qualification so native-agent/2 can drop native_unverified.

Follow-up to BI-006's live qualification. The findings and open items are in [`simplify-intake-entry/notes.md`](../archive/2026-11-07-simplify-intake-entry/notes.md) (task 13 entries), and the evidence is in [#118](https://github.com/MitchReyno/InvenTree-Importer/pull/118). Planning artifacts: [proposal](proposal.md), [design](design.md), [spec delta](specs/processing-agent-sessions/spec.md) and [tasks](tasks.md). Includes categorized session failures with operator-visible debug details. Implementation remains pending.

# Notes

## 2026-11-12T12:38+11:00

- The reclaim regressions failed first with `MODULE_NOT_FOUND` because `tooling/dev/supervisor-lock.cjs` did not exist. After the helper landed, one live-owner case failed until the second claimant had a start time in the fake process table. That was a test setup gap: the helper refuses to start when it cannot identify itself, which is the intended failure.
- The SIGHUP regression raced process startup when the suite was busy and the signal arrived before the hook was installed. The test now waits until the child writes a ready file. The hook itself did not change.
- `pnpm test:dev` passed: 86 tests. `remark` reported no issues for `docs/development.md` and this change's Markdown. A real close of a running `pnpm dev` terminal was not exercised; the automated checks cover the signal hook, the parent watch and lock reclaim, not the full Docker stack.

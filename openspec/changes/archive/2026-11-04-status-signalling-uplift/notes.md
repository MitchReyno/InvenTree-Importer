# Implementation notes

BI-002 was delivered in two PRs: tasks 1–2 in [#77](https://github.com/MitchReyno/InvenTree-Importer/pull/77) and tasks 3–4 in [#79](https://github.com/MitchReyno/InvenTree-Importer/pull/79). The header reads status only and adds no mutation authority.

## Changes to the plan

- **Proposal review:** the first plan let a healthy socket disable the existing activity polling, and it measured freshness from the last success, so a fresh failure looked stale. The plan was corrected before implementation. Connection polling now runs every 30 seconds in the foreground regardless of socket state, observations expire locally after 60 seconds, and freshness counts from the latest completed observation.

## Unexpected challenges

- **Task 2 (PR-A):** the real default HTTP adapter discarded `Content-Type`, but the probe requires a JSON response. Tests that injected a `Response` missed this, so healthy targets would have shown as unavailable. The adapter now keeps only `Content-Type` internally, and a regression runs through the actual default transport.
- **Task 2 (PR-A):** connection reads could probe the target while bootstrap still required setup. They now share the bootstrap configuration predicate, so a missing or blank credential returns `unconfigured` without a probe.
- **Task 3 (PR-B):** the generated public client entry point did not re-export the foundation's `headerClient`. The generator template was fixed and its outputs regenerated, with a regression that imports the public entry point, rather than importing through an internal path.
- **Task 3 (PR-B):** after the browser is suspended, the local clock can advance before the socket deadline timer fires. An old live observation then stayed labelled connected. Transport state is now derived from the observed time under the same 30-second policy.
- **Task 1 (PR-A):** native browser zoom could not be driven through the attached Chrome. An isolated headless profile with Chromium's default-zoom preference gave real 200% zoom, confirmed by CDP's `cssVisualViewport.zoom`. Evidence is in [status-signalling evidence](https://github.com/MitchReyno/InvenTree-Importer/tree/e3ac646/docs/bench-intake/evidence/status-signalling).

## Decisions made during implementation

- **Task 1 (PR-A):** `@radix-ui/react-popover@1.3.1` sits behind a small controlled wrapper. Floating UI and native popovers were compared in the proposal; the conditional fallback was not needed.
- **Task 2 (PR-A):** the reachability probe is `GET /api/part/?limit=1` over the existing read transport, with a 3-second deadline. It checks only the status and JSON content type, then cancels the body. It proves the API is reachable, not version compatibility or write permission.
- **Task 2 (PR-A):** each configured profile has one closure that holds one cached observation and one coalesced in-flight probe, never a global map of targets. Rotating the target context discards cached and in-flight results.
- **Task 2 (PR-A):** the work read reports queued and physically occupied sessions separately, and never infers progress percentages. Native session IDs stay out of the header DTO.

## Open items

None.

# Implementation notes

The planning PR [#277](https://github.com/MitchReyno/InvenTree-Importer/pull/277) merged into `interactive-app`. T1 exposed a conflict with an existing transport requirement before any runtime change.

## Changes to the plan

The user approved a third capability delta for the two fixed active-credential health reads.

## Unexpected challenges

- **2026-11-25T15:19+11:00, T1:** The planned nine-second protected-read success exceeds the five-second maximum for every transport call in the [inventory target protection spec](../../specs/inventory-target-protection/spec.md#requirement-target-single-send-without-retry-or-redirect). The original proposal declared deltas for header status and Capture media only. Automated overlap validation compares declared deltas and did not identify this cross-capability conflict.

## Decisions made during implementation

- **2026-11-25T16:34+11:00, T1:** Reserve one of the existing four API connections for health fences to support existing four-connection roles. Candidate-token checks keep the ordinary five-second deadline. New clients negotiate the root observation so clients with the original closed response schema still validate replies.
- **2026-11-25T16:34+11:00, T2:** Compare server-generated observation timestamps across recovery so browser clock skew and the manual-check throttle cannot revive an old badge.

## Open items

Implementation and qualification are tracked in tasks.md.

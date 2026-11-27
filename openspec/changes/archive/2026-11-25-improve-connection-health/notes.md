# Implementation notes

The planning PR [#277](https://github.com/MitchReyno/InvenTree-Importer/pull/277) merged into `interactive-app`. T1 exposed a conflict with an existing transport requirement before any runtime change.

## Changes to the plan

The user approved a third capability delta for the two fixed active-credential health reads.

## Unexpected challenges

- **2026-11-25T15:19+11:00, T1:** The planned nine-second protected-read success exceeds the five-second maximum for every transport call in the [inventory target protection spec](../../../specs/inventory-target-protection/spec.md#requirement-target-single-send-without-retry-or-redirect). The original proposal declared deltas for header status and Capture media only. Automated overlap validation compares declared deltas and did not identify this cross-capability conflict.

## Decisions made during implementation

- **2026-11-25T16:34+11:00, T1:** Reserve one of the existing four API connections for health fences to support existing four-connection roles. Candidate-token checks keep the ordinary five-second deadline. New clients negotiate the root observation so clients with the original closed response schema still validate replies.
- **2026-11-25T16:34+11:00, T2:** Compare server-generated observation timestamps across recovery so browser clock skew and the manual-check throttle cannot revive an old badge.

- T3 keeps pre-claim admission in the trusted dispatcher. Direct development uses a separately owned local process so the loss of a one-shot client does not kill another client’s decoder. Backfill recovery and read-only candidate selection precede admission; the durable claim follows activation.
- T4 qualification covers the Apple Silicon Mac at the user's direction. Raspberry Pi deployments keep one slot. The Mac budget for the matched run is two one-CPU, 1 GiB decoder containers and 1 GiB of benchmark process RSS. Interactive and integrity gates still apply before selecting two.

## Open items

The qualified MacBookPro18,3 configuration uses two slots. Raspberry Pi 5 and unqualified installations retain one. Per-host configuration and rollout are documented in the deployment guide. The implementation merged into `interactive-app` in [#279](https://github.com/MitchReyno/InvenTree-Importer/pull/279) and [#282](https://github.com/MitchReyno/InvenTree-Importer/pull/282). All tasks are complete.

# Implementation notes

## Changes to the plan

None yet.

## Unexpected challenges

- 2026-11-07, task 1: plain HTTP on the Tailscale address is not enough, because the frontend's `crypto.randomUUID()` needs a secure context. This is why the change uses `tailscale serve` HTTPS rather than binding Vite to the tailnet IP.
- 2026-11-07, task 1: Serve was not yet enabled on the tailnet. `tailscale serve` prints an admin link and waits, so the launcher turns that output into `tailscale_serve_not_enabled`.

## Decisions made during implementation

None beyond the design.

## Open items

None.

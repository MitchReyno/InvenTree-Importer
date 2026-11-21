# Implementation notes

## Changes to the plan

None yet.

## Unexpected challenges

- 2026-11-07, task 1: plain HTTP on the Tailscale address is not enough, because the frontend's `crypto.randomUUID()` needs a secure context. This is why the change uses `tailscale serve` HTTPS rather than binding Vite to the tailnet IP.
- 2026-11-07, task 1: Serve was not yet enabled on the tailnet. `tailscale serve` prints an admin link and waits, so the launcher turns that output into `tailscale_serve_not_enabled`.
- 2026-11-07, task 1: on macOS `/usr/local/bin/tailscale` is a shell script that runs the app binary as a child, not with `exec`. Signalling the launched process stopped only the script. The orphaned binary kept serving, kept its foreground config and held the child's output pipes, so shutdown timed out with `owned_app_shutdown_unconfirmed`. `launch()` gained a `group` option that signals the whole process group, and the serve child uses it. The binary removes its config on SIGTERM or SIGINT.
- 2026-11-07, task 1: plain `tailscale serve status` reports "No serve config" while foreground entries exist; only `--json` shows them.

## Decisions made during implementation

None beyond the design.

## Open items

None.

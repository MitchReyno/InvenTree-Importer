# Design assessment

## Context and grounding

See the [proposal](proposal.md). The full-stack launcher (`tooling/dev.cjs`) owns child processes through `tooling/dev/process.cjs`; the UI child survives source reloads while application services restart.

## Goals and constraints

- The API keeps seeing only loopback authority; its Host/Origin and CSRF checks stay authoritative and unchanged.
- HTTPS, so the browser provides a secure context.
- Off by default, fail before any setup when Tailscale cannot serve, and leave no serve configuration behind.

## Decisions and alternatives

- **D1 — foreground `tailscale serve --https=<port>` in front of a loopback gateway.** Tailscale supplies TLS and the user identity. Foreground mode ties the configuration to the child's lifetime. Rejected: `--bg` serve, which persists after a crash.
- **D2 — the gateway admits exactly one origin and one user.** The Host must equal the MagicDNS host (with the port unless 443). An Origin, when present, must equal the HTTPS origin. `Tailscale-User-Login` must equal this node's owner from `tailscale status --json`. Anything else gets `403` before reaching Vite. Admitted requests have Host, and Origin when present, rewritten to `http://127.0.0.1:<INTAKE_DEV_PORT>`, and their `Tailscale-*` headers removed. The translation is one-to-one, so the API's equality checks keep their meaning.
- **D3 — the gateway listens on loopback only.** Local processes could already reach Vite directly; nothing new is exposed off-machine except through Serve.
- **D4 — both children are front-door processes.** Like `ui`, they are excluded from the source-reload drain and restart; their unexpected exit stops the app.
- **D5 — options.** `--tailscale` or `INTAKE_DEV_TAILSCALE=1` enables; `INTAKE_DEV_TAILSCALE_PORT` (default 443) picks the serve port. Both settings join the environment-file allowlist.

## State, authority and failure behavior

No retained data changes. Failures use launcher error codes: `tailscale_unavailable` (no CLI or unreadable status), `tailscale_not_running`, `tailscale_owner_unknown`, `tailscale_serve_not_enabled` (after the CLI prints the enable link), `invalid_tailscale_setting`, `invalid_tailscale_port`. The gateway exits immediately on SIGTERM because it holds no state and upgraded sockets would otherwise keep it alive.

# Change proposal

## Problem and intended outcome

`pnpm dev` binds Vite to `127.0.0.1:4330`, and the API refuses any request whose Host or Origin is not exactly that loopback origin (`intake-server/src/config.ts`, `intake-server/src/api/server.ts`, `intake-server/src/live/routes.ts`). Using the app from a phone at the bench meant running a hand-made proxy on the Tailscale address. That proxy was plain HTTP, and the frontend calls `crypto.randomUUID()`, which browsers expose only in a secure context.

The outcome: an opt-in `pnpm dev --tailscale` (or `INTAKE_DEV_TAILSCALE=1`) serves the app at `https://<MagicDNS name>/` to the node owner only, and stops cleanly with the rest of the app.

## Change identity and linked items

Canonical name: `dev-tailnet-access`. Branch `feat/dev-tailscale`; subjects `feat(dev-tailnet-access): …`.

Linked BI items: none. This is developer tooling, not product functionality.

## Current behavior and evidence

- `devConfig` throws `loopback_origin_required` for any non-`127.0.0.1` origin; the API `onRequest` hook compares Host and Origin exactly; the live socket compares Origin exactly.
- `tooling/dev/ui.cjs` proxies `/api` to the private API listener with `changeOrigin: false`, so the browser's Host reaches the API.
- `tailscale serve` (1.102) terminates HTTPS with a tailnet certificate, preserves the request Host, and adds `Tailscale-User-Login` for the requesting user. A foreground `tailscale serve` removes its configuration when the process exits.

## Scope and non-goals

In scope: the launcher option, a loopback gateway child, a foreground `tailscale serve` child, tests, and the development guide.

Not in scope: Tailscale Funnel or any internet exposure, allowing additional origins in the API, standalone `dev:ui`/`dev:intake`, and enabling Serve on the tailnet (an admin action).

## Reuse and dependency assessment

- `tailscale serve` is reused for TLS, certificates and tailnet identity instead of local certificates (mkcert) or a self-signed listener, which phones would distrust.
- The gateway is a short `node:http` reverse proxy. Rejected: adding `http-proxy`/`http-proxy-middleware` (a new dependency for about 60 lines of forwarding) and Vite's own proxy options (they would change the loopback request path the API already relies on).
- Rejected: teaching the API a second allowed origin. It would widen a deliberate loopback-only invariant across `config.ts`, the request hook and the live socket.

## Capabilities

### New capabilities

None.

### Modified capabilities

None. The change declares `skip_specs: true`: it is development tooling and leaves product behavior unchanged.

## Impact and dependencies

Default `pnpm dev` behavior is unchanged. With the option, startup additionally needs a running, logged-in Tailscale with Serve enabled for the tailnet.

## Open decisions and assumptions

- Assumed: restricting access to the node owner's login is the right default for a single-developer tailnet. Other tailnet users and tagged devices are refused.

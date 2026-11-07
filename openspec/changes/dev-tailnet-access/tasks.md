# Implementation and delivery tasks

## Plan context

Canonical change: `dev-tailnet-access`; no linked BI item (see the [proposal](proposal.md)). The [design](design.md) records decisions D1–D5. The change declares `skip_specs: true`. Branch `feat/dev-tailscale`; subjects `feat(dev-tailnet-access): …`.

## Completion and commit ordering

Check each action after it is done and verified, and commit the `tasks.md` update with its work. Review, publication, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Tailnet gateway and launcher option | Tooling | None | Design D1–D5 |
| 2. Documentation | Documentation | 1 | Proposal outcome |

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | `pnpm dev --tailscale` serves the app over tailnet HTTPS to the node owner | Tasks 1–2 in full | Small, self-contained tooling change; the docs describe the option it adds | None | `interactive-app`, `feat/dev-tailscale`, `feat(dev-tailnet-access): serve pnpm dev over tailnet HTTPS` | `pnpm test:dev`, format and Markdown checks, a real tailnet run, independent exact-head review, selected CI |

## 1. Tailnet gateway and launcher option

- PR delivery: PR-A.
- Outcome: the option starts a loopback gateway and a foreground `tailscale serve`, both surviving reloads; refusals and failures behave as designed.
- Scope and approach: `tooling/dev/tailnet.cjs`, `tooling/dev.cjs`, `tooling/dev/environment.cjs`, `tooling/tests/dev-tailnet.test.cjs`, `package.json` `test:dev`.
- Prerequisites: None.
- Acceptance: design D1–D5.
- TDD approach: unit tests for option parsing, identity parsing and header translation; an in-process gateway test against a fake upstream for HTTP and WebSocket upgrade forwarding and refusal.
- Verification: `pnpm test:dev`; a real `pnpm dev --tailscale` run loading the app and live socket through the MagicDNS URL, then confirming `tailscale serve status` is empty after Ctrl-C.

- [x] 1.1 Add option parsing, identity discovery, header translation and the gateway, with tests.
- [x] 1.2 Launch the gateway and serve children from `pnpm dev`, keep them across reloads, and add the settings to the allowlist.
- [ ] 1.3 Verify a real tailnet run end to end and serve cleanup.

## 2. Documentation

- PR delivery: PR-A.
- Outcome: the development guide explains enabling, requirements, failure codes and the access rule.
- Scope and approach: `docs/development.md` (new "Tailnet access" section and allowlist), `intake-server/ARCHITECTURE.md`.
- Prerequisites: task 1.
- Acceptance: proposal outcome.
- TDD approach: documentation; claims checked against the code.
- Verification: `pnpm lint:markdown`; `pnpm format:check`.

- [x] 2.1 Document tailnet access and the new settings.

## Delivery evidence and lifecycle follow-up

- [ ] D.1 PR-A: independent exact-head review clear (record the SHA), selected CI green, published, and merged under user authorization.

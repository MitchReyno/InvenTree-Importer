# Delivery plan

All bundles target `interactive-app`, in A through D order. Use independent exact-head review and selected green checks for each. Attach evidence to its PR. Each bundle owns the whole numbered task in its row.

| Bundle | Task and branch | Proposed subject | Gate |
| --- | --- | --- | --- |
| A | 1, feat/shared-vm-agent-runner-images | feat(shared-vm-agent-runner): package app and guest services | Two-host synthetic boot |
| B | 2, feat/shared-vm-agent-runner-bridge | feat(shared-vm-agent-runner): supervise remote turns | Recovery and isolation checks |
| C | 3, feat/shared-vm-agent-runner-auth | feat(shared-vm-agent-runner): configure personal provider access | UI, secret and provider protocol checks |
| D | 4, docs/shared-vm-agent-runner-qualification | docs(shared-vm-agent-runner): document qualified deployments | Both host reports and documented limits |

## 1. Package portable services

- [x] 1.1 Establish a clean deployment fixture with disposable data. Show that the existing development Compose stack cannot deploy the app and guest from release images.
- [x] 1.2 Build pinned ARM64 image stages and two Compose manifests. Include static UI, server, contracts, Python adapter, decoder dispatch and separate least-privilege service entries. Verify executable distribution and license notices.
- [x] 1.3 Provision one private Lima guest on each host. Verify host/guest kernel boundary, denied mounts, origin checks, restricted DB roles, existing dev startup and persistence across image replacement. Publish reproducible build instructions and digest manifest.

## 2. Execute remote turns and deliver evidence

- [x] 2.1 Add failing contract, PG and process tests for duplicate dispatch, lost ACK, stale attempt, runner restart, orphan descendants and cancellation of only one concurrent session.
- [x] 2.2 Implement authenticated pairing, bounded streams, durable identity and reconciliation at the session driver. Add the VM provider profile and scoped MCP/evidence bridge. Preserve old profile and approval semantics.
- [x] 2.3 Verify resume with a retained question and exact source citation, unreachable private destinations and permitted browsing. Run pnpm test, pnpm test:intake:pg and pnpm test:intake:process with controlled CLIs.

## 3. Connect providers from Agent Settings

- [x] 3.1 Write failing API, UI and guest tests for unauthorized, stale and offline secret writes, failed deletion, interrupted sign-in and accidental logging of a synthetic sentinel.
- [x] 3.2 Deliver explicit Claude save, replace and remove actions and the private guest credential lifecycle. Verify no replay from autosave, no read-back, no secret-bearing backups and no alternate billing fallback.
- [x] 3.3 Add Sign in with ChatGPT using the pinned app-server RPC. Test phone URL/code display, cancellation, denial, late completion, disconnect, reauthentication and persistence after guest container replacement.
- [x] 3.4 Run frontend typecheck, lint, tests and build plus affected contract, PG and process tests. Verify settings reads never launch inference.

## 4. Qualify personal installations

- [ ] 4.1 Run matching image digests on the physical M1 and Pi 5. Exercise concurrent sessions, scripts, image crops, browser, idle resume, cancellation, restart and rollback. Record resource measurements and limits.
- [x] 4.2 With explicit live-test authority, complete a turn using each selected subscription, including remote-device approval for the Pi. Report fixture and live evidence separately.
- [ ] 4.3 Update operator setup, troubleshooting, recovery and owning architecture references. Record actual blockers in notes and attach qualification evidence to the PR. Archive only after implementation acceptance.

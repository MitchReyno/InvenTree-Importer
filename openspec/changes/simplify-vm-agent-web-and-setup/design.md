# Design assessment

## Context and grounding

This change crosses five boundaries, but each one extends an existing pattern. There is no new service and no new runtime dependency.

| Boundary | Owner today | Evidence (`interactive-app` at `1d20c6fc`) |
| --- | --- | --- |
| Provider tool surface and admission | Intake server session adapters | `agents/session/session-adapters.ts:86-260` (Claude), `:277-541` (Codex); `claude-session-admission.ts`; `session-admission.ts:12,27-52` |
| Per-turn containers in the VM | `tooling/deployment/bridge/tool-turn.sh` | Starts `$name-egress` (`:43-45`), the worker with `--network=none` (`:49-51`) and the supervisor peer (`:59-62`). Checks the reader socket (`:30`). |
| Egress policy | `bridge/claude-egress.py`, `guest_destinations.py` | Provider-only CONNECT allowlist, IPv4 answers only, connects to `addresses[0]` |
| Turn delivery | Coordinator to peer over paired TLS | `shared-vm/coordinator.ts:138-155` sends `manifest`, `tools`, `text`, `instructions`. `guest-main.ts:73` validates `ProcessingInputV6`. `:127-139` writes the reap receipt to `/run/reap`, visible only to the peer and `tool-turn.sh`. |
| CLI proxying | `agents/environment.ts:66-78` | Sets `HTTPS_PROXY=http://127.0.0.1:14316` for subscription routes. `shared-vm/provider-proxy.ts` forwards it to `/run/egress/<provider>.sock`. |
| Settings and sealing | Agent settings (`agents/settings.ts`) and `processing/session-attempts.ts` | `settings-debug-mode` (BI-016, unmerged, `docs/settings-debug-mode` at `f44736ef`) restructures Settings › Agents. It also seals per-step selections and the Part description style into the attempt input. |
| Instructions | `agents/session/session-runner.ts` | Fixed instructions are digest-verified per profile (`processing/authority.ts:73,110-113`, `session-runner.ts:458`) |
| Setup | README and `bridge/*.sh`; `tooling/dev/vm.cjs` | `pair.sh` needs new directories. `personal-claude.sh` and `personal-codex.sh` use `docker run --name` and fail if the container exists. Each management container takes one `INTAKE_OPERATOR_ORIGIN`. |

**Complexity:** large but conventional. The risky parts are the security of the policy handoff and the provider tool behaviour behind the egress proxy, which only a live run proves.

## Goals and constraints

The requirements are the deltas in `specs/`. The constraints that shape the design:

- The worker container runs agent-controlled code, so it must never be able to change the web policy.
- The relay starts the egress container before the turn is known (`relay.mjs:60-90`), so the policy arrives after the containers start.
- Attempts sealed before this change must behave as before. That means web off, not a crash.
- `vm:setup` and the image refresh must never destroy a pairing, a sign-in or the VM disk.

## Decisions and alternatives

### D1. One per-turn egress proxy enforces the web policy; the reader goes

`claude-egress.py` is renamed to `guest-egress.py`, because it now serves both providers and the web. It keeps its provider allowlist and gains a public branch, which applies `guest_destinations.py` checks once the turn's policy says web access is on. The public branch:

- resolves both IPv4 and IPv6 answers, requiring all of them to be public;
- connects to the first checked address, as today;
- answers each refusal with `HTTP/1.1 403` and an `X-Bench-Refusal: <reason>` header, so `curl -v` and the agent can see the reason;
- never logs the requested host.

The long-lived `bench-claude-egress` and `bench-codex-egress` containers started by `personal-*.sh` run the same file without a policy. They stay provider-only.

**Rejected:**
- *Keep the reader beside the proxy:* this duplicates policy and keeps the manual lifecycle.
- *Squid or tinyproxy:* neither can express the mixed-answer and protected-address rules without custom helpers. See the proposal's assessment.

**Accepted trade-off:** the proxy can't insist on https, check status or cap size inside TLS. CONNECT is limited to port 443.

### D2. The supervisor hands the policy to the egress proxy

```text
coordinator ──TLS──▶ peer (supervisor) ──writes──▶ $turn/policy/policy.json ──read-only──▶ egress
     │ manifest (sealed web fields)                       (not mounted in the worker)
     └ protected_hosts (worked out per turn)
```

- `tool-turn.sh` creates `$turn/policy`. It mounts it read-write into the peer only, and read-only into the egress container. The worker never sees it, the same isolation `/run/reap` already relies on.
- The peer validates the command:
  - the sealed `web` fields from the manifest;
  - `protected_hosts`, a new command field holding at most 32 lowercase DNS names.

  It then writes `policy.json` atomically (temporary file, then rename), before it starts the worker turn.
- The egress proxy reads the file on each CONNECT. Missing or invalid means provider-only.
- Codex and Claude both see the same file.

**Rejected:**
- *Relay argument:* the turn isn't known when the relay starts.
- *Environment from the worker:* agent-writable.
- *Writing the policy into the sealed manifest only:* protected hosts are deployment facts, not attempt facts. Sealing them would make an old attempt carry stale hosts.

### D3. Sealed web fields on the session input

The shared session input gains an optional `web` object, `{ public_pages: boolean, prefer_datasheets: boolean }`. It is set by `createSessionAttempt` from the saved agent settings, exactly as `settings-debug-mode` seals `part_description_style`.

- Absent means both off.
- Profiles other than `shared-vm-agent/2` always seal both as off.
- Defaults are on: a settings row with no saved value reads as on.

The fields are optional, so the input schema version doesn't change. If `settings-debug-mode` has bumped the input version by then, these fields join that version. That decision is recorded in `notes.md` during implementation.

### D4. Protected hosts are worked out by the coordinator

`protectedHosts()` in the intake server collects:

- the hostnames of the configured InvenTree URLs (`INTAKE_INVENTREE_URL`, and the target used for writes when it is configured);
- the app's public names (the tailnet certificate name when `INTAKE_DEV_TAILSCALE` is on, and any configured public origin).

IP literals, `localhost` and names with private suffixes are dropped, because the destination rules already refuse them. The skip for "resolves only to non-public addresses" happens in the egress proxy, because only the guest's DNS is authoritative for what the agent would reach.

`INTAKE_VM_PROTECTED_HOSTS` is removed. Its one remaining reader, the long-lived egress started by `personal-*.sh`, has no public branch, so it doesn't need one.

### D5. Tool surface and admission

**Claude:**
- `builtins` becomes `['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'WebSearch', 'WebFetch']` when `guestTools` is on.
- The expected-tool comparison and the in-turn `tool_use` check reuse that list.
- `--disallowedTools advisor` and the agent-set check stay.

**Codex:**
- `CODEX_SESSION_CONFIG` for guest tools sets `web_search: 'live'`.
- It also sets `shell_environment_policy.set.HTTPS_PROXY` (and `NO_PROXY`), so shell commands use the egress proxy whatever the inherit policy is.
- `requireCodexSessionConfig(config, guestTools)` expects `'live'` and that `set` block when `guestTools` is on, and `'disabled'` otherwise.
- `requireAppItem` accepts `webSearch` items when `guestTools` is on.
- The 0.166.0 bindings confirm the `live` value and the `webSearch` item.

**Both:** `ADMISSION_POLICY` moves to `native-session-direct-tools/2`. Existing admissions then report resume unavailable, the specified outcome.

**Rejected:**
- *`web_search: 'cached'`:* stale results for part lookups, and no benefit to confinement.
- *Relying on Codex's default env inheritance:* not visible to admission.

### D6. Guidance

- **Fixed instructions:** a short web-tools paragraph is added to the `shared-vm-agent/2` fixed instructions only. This changes that profile's digest, which requalification covers.
- **Opening message:** the session runner adds the per-session lines (web on or off, datasheet preference), the same channel the description style uses. The digest is unaffected.

### D7. Readiness reports the real web state

`contracts/src/live.ts` replaces `research: 'unqualified'` with `web: 'available' | 'unavailable'`. `readiness.ts` and the `web_ready` log derive it from the profile. `Diagnostics.tsx` shows "Web access: available in VM sessions" or "Unavailable for this profile".

Since the contract field changes, the frontend and server move together in one PR.

### D8. `pnpm vm:setup`

`tooling/dev/vm-setup.cjs` reuses `tooling/dev/settings.cjs` and `vm.cjs` for names, defaults and the Lima helpers. Steps, each checked before it acts:

| Step | Already done when | Action |
| --- | --- | --- |
| Prerequisites | `limactl` and `docker` on `PATH` | Refuse `vm_setup_prerequisite_missing` |
| Images | Each local tag carries the current source digest (D9) | `docker buildx build` (app, guest), `docker build` (runner) as in the README |
| VM | `limactl list` shows the instance | `limactl start --vm-type=vz --name=<vm> tooling/deployment/lima/agent.yaml`, or start it if stopped |
| Runner in guest | Guest `docker image inspect` digest label matches | `docker save \| limactl shell … docker load` |
| Pairing | Host `ca.pem`, `cert.pem` and `key.pem`, and the guest `guest/` directory, both exist | `pair.sh`. One side only: `vm_pairing_mismatch`. |
| Operator key | The key file exists | Created by the provisioning script, which already does this |
| Guest services | Containers exist with the current image and the expected `INTAKE_OPERATOR_ORIGIN` | Run `personal-claude.sh` and `personal-codex.sh`. Both are changed to remove only their own named containers first, and to leave the store, state and key directories alone. |

The VM is stopped at the end only if this run started it, unless `INTAKE_VM_KEEP_RUNNING` is true. The run ends by printing the two `.env` switches and the sign-in step.

**Rejected:**
- *A shell script:* the launcher's settings, defaults and tests are in Node already.
- *Doing setup inside `pnpm dev`:* building three images on first `pnpm dev` would hide a long step behind the app start.

### D9. Runner image freshness

- The digest is a SHA-256 over the sorted list of `path` plus file-content hash for tracked and untracked, non-ignored files under:
  - `tooling/deployment/images/`, `tooling/deployment/guest/`, `tooling/deployment/bridge/`;
  - `intake-server/src/`, `contracts/src/`, `media-decoder/src/`;
  - `intake-server/package.json`, `contracts/package.json`, `media-decoder/package.json`;
  - the root `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
- The build passes it as `--label org.bench-intake.source-digest=<digest>`.
- Before starting the relays, `pnpm dev` (managed) reads the label from the guest. If it differs, it runs D8's image, load and guest-service steps.
- With management off, it only warns.

**Rejected:**
- *A Git commit SHA:* misses uncommitted edits, which are exactly the common case during development.
- *Docker build cache alone:* it still needs a build and a load to find out.

## State, authority and failure behavior

| State | Owner | Identity and revision | Failure handling |
| --- | --- | --- | --- |
| Web settings | Agent settings row | Existing revision check (`settings-debug-mode`) | A stale save is refused as a conflict |
| Sealed web fields | Attempt input | Immutable after queue | Absent means off |
| Protected hosts | Coordinator, per turn | Recomputed each turn, never stored | Invalid names are dropped. A public name that fails to resolve gives `resolution_failed` for public hosts. |
| Turn policy file | Peer writes, egress reads | Per turn directory, removed by `tool-turn.sh` cleanup | Missing or invalid means provider-only |
| Runner image digest | Image label | Content digest | A failed refresh gives `vm_runner_image_refresh_failed` before the relays start |
| Pairing, keys, sign-ins | Guest and host private directories | Never replaced by setup | A one-sided pairing gives `vm_pairing_mismatch` |

**Authority:** the agent has no route to `$turn/policy`, the peer's TLS identity or the coordinator. The settings write path is unchanged, and so is inventory write authority.

**Search privacy:** provider search queries leave through the provider's own service. They are outside the egress policy, accepted on 2026-11-19, and the Settings text discloses this.

## Verification strategy

| Risk or outcome | Check | Boundary proven |
| --- | --- | --- |
| Destination rules, refusal reasons, IPv6 and mixed answers, protected aliases, ports | Python `unittest` for `guest-egress.py` with synthetic DNS, ported from `tests/test_web_reader.py` | Proxy policy logic |
| Policy handoff | Peer unit test: a valid command writes `policy.json` atomically, and an invalid `protected_hosts` is refused. `tool-turn.sh` mount test: the worker has no `/run/policy`. | Supervisor and mount wiring (synthetic) |
| Tool surface and admission | Update `session-admission.test.ts`, `claude-session-admission.test.ts` and the adapter argument tests. RED first on the new lists and the `webSearch` item. | Adapter contract against recorded CLI frames |
| Sealing and defaults | `session-attempts` tests next to `settings-debug-mode`'s description-style tests | Queue-time sealing |
| Guidance | `session-runner` tests: opening message lines, digest unchanged by settings, no web text for `native-agent/2` | Instruction assembly |
| Readiness | Contract and readiness tests, `Diagnostics` component test | Live contract and UI |
| Settings UI | `AgentsSection` tests for the switches, disabled profile, save and conflict | Frontend |
| `vm:setup` and freshness | `pnpm test:dev` tests (`tooling/tests/`) with an injected `exec`, like `dev-vm.test.cjs`: fresh run, rerun no-op, mismatch, missing tool, failed step, VM stop rules, digest match and mismatch | Orchestration logic |
| Real VM | `tooling/deployment/tests/guest-tools-smoke.sh` and `tool-worker-smoke.sh`, extended so a public `curl` succeeds with web on and fails with web off, and a private target fails | VM wiring, needs the paired VM |
| Provider behaviour (WebFetch through the proxy, its domain preflight, search, Codex shell proxy) | Live requalification run, last, with Mitch's go-ahead | Real providers |

## Migration, rollout and recovery

- **Order:** BI-016 merges first. This change's PRs then go in the order in `tasks.md`. The egress and policy PR lands before the tool surface PR, so `WebFetch` never runs without the policy.
- **Existing setups:**
  - The old `bench-public-reader` container is removed by the next `vm:setup` or image refresh, and is harmless if left.
  - The README tells existing users to run `pnpm vm:setup` once. It keeps their pairing and sign-ins.
  - Existing conversations can't resume across the admission policy change.
- **Rollback:** revert the PRs. Old attempts never had web fields, and new attempts with web fields are ignored by older code, so no data migration is needed.
- **Observability:** each egress refusal is counted by reason in the turn's diagnostic counters, without hosts.

## Risks and open decisions

- **WebFetch preflight.** Claude Code may check a domain with an Anthropic endpoint before fetching. If that endpoint isn't `api.anthropic.com`, `WebFetch` fails until it is added to the provider allowlist or the preflight is turned off. This is found in the smoke or live run, and recorded in `notes.md`.
- **Provider search hosts.** Search is expected to run inside the provider's API. If either provider needs another host, it is added to that provider's allowlist after review.
- **`settings-debug-mode` drift.** The `app-settings` delta and sealing code are written against `f44736ef`. Rebase both when it merges.
- **Other `app-settings` changes.** `pnpm openspec:overlap` warns that active change `masthead-appearance-options` also changes `app-settings`. The requirements don't overlap, but the sync order needs confirming before either change syncs.
- **Pairing certificates expire after 365 days** (`pair.sh`). This is out of scope, recorded as an open item.
- **Decisions:** none open. Mitch settled them on 2026-11-19, as listed in the proposal.

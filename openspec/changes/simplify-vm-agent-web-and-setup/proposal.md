# Change proposal

## Problem and intended outcome

Agents in the shared VM (`shared-vm-agent/2`) can barely use the web, and getting them that far takes a long manual setup.

- **Web access is narrow and hidden.** The only route is `bench-web`, a `curl` wrapper around a separate document reader. By default the reader allows three sites, none of them useful for parts research. The fixed instructions mention it only for those three sites, and there is no search.
- **The provider tools that would help are off.** Claude's `WebSearch` and `WebFetch` and Codex's `web_search` are all refused, even though the VM sandbox contains everything that runs locally.
- **Setup is long and fragile.** A fresh clone needs about a dozen manual commands: build three images, create the VM, load the image, pair, and provision both providers and the reader. Web policy is set through shell variables passed to a one-off script, including a hand-written list of protected hostnames. Guest code changes need a manual rebuild and reload.

The outcome Mitch asked for on 2026-11-19:

1. VM agents get provider web search, Claude `WebFetch`, and Claude's in-container `Glob` and `Grep`.
2. A per-session "Allow public web pages" setting, on by default, decides whether a session can reach public sites. The per-turn egress proxy enforces it, with protected hosts worked out automatically, so there are no web settings in the environment.
3. `bench-web` and the document reader are removed.
4. A fresh clone gets real VM agents with `pnpm vm:setup`, two `.env` switches and a sign-in. `pnpm dev` keeps the runner image current by itself.

## Change identity and linked items

Change name: `simplify-vm-agent-web-and-setup`. Delivering branches include it, for example `feat/simplify-vm-agent-web-and-setup-egress`, and subjects use `type(simplify-vm-agent-web-and-setup): description`.

Linked item: BI-017 in [`docs/PLANNED_FUNCTIONALITY.md`](../../../docs/PLANNED_FUNCTIONALITY.md). It takes over BI-015's web research switches. BI-016 (`settings-debug-mode`) is a prerequisite, and BI-010 governs the Codex tool surface.

## Current behavior and evidence

Checked against `interactive-app` at `1d20c6fc`.

| Area | Today | Evidence |
| --- | --- | --- |
| Claude tools in the VM | `Bash`, `Read`, `Write` and `Edit` only. Admission refuses any other tool list, and any other `tool_use` ends the turn. | `intake-server/src/agents/session/session-adapters.ts:98,159-224`; `claude-session-admission.ts` |
| Codex tools in the VM | Shell, file changes and image viewing. `web_search: 'disabled'` is required by admission. | `session-adapters.ts:282-290,512`; `session-admission.ts:27-52`; `codex.ts:13` |
| Network | The tool worker runs with `--network=none`. The CLI reaches its provider through `HTTPS_PROXY=http://127.0.0.1:14316`, which forwards to a per-turn CONNECT proxy that allows only the provider's hosts. | `tooling/deployment/bridge/tool-turn.sh:33-51`; `intake-server/src/agents/environment.ts:68`; `shared-vm/provider-proxy.ts`; `bridge/claude-egress.py:11` |
| Web reads | `bench-web` sends one URL over `/run/web/reader.sock` to a long-lived reader container. Its policy covers https only, DNS-name and public-address checks, protected hosts, 4 redirects and 2 MiB. The default mode is `listed`, with three sites. | `bridge/web-reader.py`, `guest_destinations.py`, `bench-web`, `public-web.sh` |
| Reader lifecycle | Started by hand with `public-web.sh`. `tool-turn.sh` refuses to run without its socket. Not started by `pnpm dev`. | `tool-turn.sh:30`; `README.md:126-130` |
| What agents are told | The profile's fixed instructions say to use `bench-web` with HTTPS URLs on the three listed sites, nothing more. | `intake-server/migrations/0026_shared_vm_tools.sql:11` |
| Settings | "Web research" switches render disabled. | `openspec/specs/app-settings/spec.md` › Deferred settings |
| Readiness | Always reports `research: 'unqualified'`, a label for the retired fixture broker. | `operations/readiness.ts:43`; `contracts/src/live.ts:38`; `main.ts:206` |
| Setup | Images, VM, pairing, provider provisioning and the reader are all manual. `pnpm dev` refuses with `vm_pairing_missing` until they are done. | `README.md:75-140`; `development-launcher` spec |

The full investigation is in Mitch's handover findings for this work, outside the repository.

**Verified for proof of fit (2026-11-19):**
- The pinned Codex CLI 0.166.0's generated app-server bindings declare `WebSearchMode = "disabled" | "cached" | "indexed" | "live"`, and a `webSearch` thread item.
- The relay starts `tool-turn.sh` before the coordinator sends the turn (`relay.mjs:60-90`). So per-turn policy can't be a relay argument.
- The paired supervisor container validates the sealed manifest when the turn arrives (`shared-vm/guest-main.ts:73`).

**Unverified, to be proved in implementation:**
- Claude Code's `WebFetch` follows `HTTPS_PROXY`, and its domain preflight works through the allowed egress.
- Codex shell commands receive the proxy variables set through `shell_environment_policy`.
- Provider search works through the existing provider egress, with no extra hosts.

## Scope and non-goals

**In scope:**
- **Profile version.** The new tool surface and instructions run under a new profile, `shared-vm-agent/3`, added by an additive migration. `/2` and its migration stay as they are, and `/2` attempts reaching a `/3` worker fail with `agent_profile_retired`.
- **Tool surface.** In VM tool sessions, Claude adds `WebSearch`, `WebFetch`, `Glob` and `Grep`, and Codex sets `web_search = "live"`. Both admission checks and in-turn item checks are updated. The session policy identity changes, and a requalification run follows.
- **Egress policy.** The per-turn egress proxy enforces the turn's sealed web setting. Provider hosts are always allowed. When web access is on, any public host that passes the shared destination checks is allowed too. Protected hosts are worked out from the deployment's own configuration.
- **Settings.** "Allow public web pages" (on by default) and "Prefer manufacturer datasheets" (on by default) become working, per-session Settings › Agents switches, sealed into each attempt. Guidance about both is delivered to the session.
- **Retirement.** `bench-web`, `web-reader.py`, the `bench-public-reader` container, `public-web.sh`, the reader socket mount and check, and the `INTAKE_VM_WEB_MODE`, `INTAKE_VM_WEB_ORIGINS` and `INTAKE_VM_PROTECTED_HOSTS` settings are removed. The reader's policy tests move to the proxy.
- **Instructions.** Agents are told what web access they have: search, `WebFetch` to find and skim, and `curl` for raw documents and exact values.
- **Setup.** A rerunnable `pnpm vm:setup` performs the README's one-time steps. `pnpm dev` rebuilds and reloads a stale runner image. The README's VM section shrinks to match.
- **Readiness.** The fixed `research: unqualified` label and the frontend's fixed Research wording are replaced with the real web state.

**Non-goals:**
- Agents run directly on Mitch's Mac (`native-agent/*`) keep no built-in tools and no web access.
- Citable receipts for web pages. A future server-side `fetch_web` app tool will provide them for both routes.
- Account connectors and apps, plugins, Codex memories, host skills and subagents stay off.
- The Claude Agent SDK migration, the research broker and the Raspberry Pi deployment.
- Lima and Docker installation itself, which stays a documented prerequisite.

**Constraints:**
- The live requalification run needs Mitch's fresh go-ahead.
- Attempts sealed before this change have no web field and run with web access off.
- Existing pairings, provider sign-ins and VM disks must keep working, and `vm:setup` must never re-pair or wipe them.
- No real local data is migrated.

## Reuse and dependency assessment

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| **Extend the existing egress proxy** (`claude-egress.py`, Python standard library) | Already per turn, already a CONNECT proxy, already uses `guest_destinations.py`. One small file gains a policy, and the reader is deleted. No new dependency. | It can't see inside TLS, so it can't insist on https, check status or cap size exactly. Accepted, because `WebFetch` and `curl` need a general proxy anyway. | `tooling/deployment/bridge/claude-egress.py`, `guest_destinations.py` at `1d20c6fc`, read 2026-11-19 | Whether Claude's `WebFetch` honours `HTTPS_PROXY` (a smoke test in task 1) |
| Squid or tinyproxy in the runner image | Mature CONNECT proxies with domain ACLs. | No per-request pinning of DNS answers, and no refusal of mixed public and private answers or protected-address aliases without custom helpers. Adds a package and configuration to a locked-down image. | Squid ACL documentation (`dstdomain`, `dst`), squid-cache.org, 2026-11-19 | Would still need custom helper code for the address checks |
| Keep the separate reader beside the proxy | Keeps reader-only checks (GET only, status 200, 2 MiB). | Two policy services, a long-lived container and the manual setup this change removes. `WebFetch` and `curl` still need the proxy route. | Discussion with Mitch, 2026-11-19 | None |
| Lima templates and existing bridge scripts, driven from Node (`tooling/dev`) | Reuses `agent.yaml`, `pair.sh`, `personal-claude.sh` and `personal-codex.sh` unchanged, adding a thin orchestrator with tests like `tooling/dev/vm.cjs`. | Needs safe-to-rerun checks around scripts that require new directories. | `README.md:75-140`; `tooling/dev/vm.cjs`, 2026-11-19 | Rerun detection for an existing pairing and provisioned guest |
| Colima or another Lima wrapper | One-command Docker VMs. | Replaces the qualified `vz` VM and its Docker engine, and doesn't know about pairing or provisioning. | colima GitHub README, 2026-11-19 | Not pursued |
| Docker image label holding a content digest | Built into Docker (`LABEL`, `docker image inspect`). Cheap staleness check inside the VM. | Needs a fixed list of guest-relevant inputs. | Docker documentation for `LABEL` and `image inspect`, 2026-11-19 | Which files to hash. The design lists them. |
| Provider SDKs (Claude Agent SDK 0.3.328, Codex SDK 0.170.0) | — | Out of scope. The Codex SDK runs `codex exec`, which would lose steering and admission checks. | npm registry and package contents, 2026-11-19 | Not pursued |

**Recommended:**
- Extend the existing egress proxy and shared destination module.
- Orchestrate the existing bridge scripts from a new `pnpm vm:setup`.
- Use an image label digest for staleness.

This adds no new runtime dependency. Rejected options either duplicate policy (the separate reader), can't express the address rules without custom code anyway (Squid), or replace the qualified VM (Colima).

## Capabilities

### New capabilities

None.

### Modified capabilities

- `shared-vm-execution`: the VM session tool surface, web policy enforced at the per-turn egress, protected hosts worked out automatically, and the reader removed.
- `processing-agent-sessions`: the web settings are sealed per attempt and their guidance is delivered to sessions.
- `app-settings`: the Web research switches become working settings. This is written against `settings-debug-mode`'s version of the spec.
- `development-launcher`: one-command VM setup, stale runner image refresh, and the missing-pairing message pointing at `pnpm vm:setup`.
- `operations-backup-restore`: readiness reports the real web state instead of `research: unqualified`.

## Impact and dependencies

**Affected areas:**
- **Intake server:** the session adapters and admission, `shared-vm` guest supervisor and environment, session instructions, agent settings and attempt sealing, and readiness.
- **Contracts:** the processing input web fields, the agent settings fields, and the live readiness field.
- **Frontend:** the Settings › Agents web rows and the diagnostics wording.
- **Tooling:** `tooling/deployment/bridge/*` (egress policy, `tool-turn.sh`, retired reader files), the runner image, `tooling/dev` (`vm:setup`, image freshness), the root README, `docs/development.md`, `tooling/deployment/README.md` and `.env.example`.

**Prerequisites:**
- BI-016 (`settings-debug-mode`) must merge first. It owns the Settings › Agents structure and the per-attempt sealing this change extends.
- Coordinate with BI-010 before changing Codex features.
- Requalification needs a live provider run with Mitch's go-ahead.

**Compatibility:**
- The VM session admission policy identity changes, so conversations admitted under the old policy can't resume and start fresh.
- Older attempts without web fields run with web access off.
- Readiness's `research` field is replaced by `web`. A browser tab left open across the upgrade reports local setup checks as unavailable until it is reloaded.

## Open decisions and assumptions

**Decided by Mitch on 2026-11-19:**
- Allow provider search and `WebFetch`.
- Web on by default, as a per-session switch.
- Merge the web policy into the egress proxy.
- Remove `bench-web`.
- Include `vm:setup` in this change.

**For Mitch to confirm:** any `shared-vm-agent/2` attempt that a `/3` worker finds, whether queued or requeued by a message to a finished session, fails with `agent_profile_retired`, keeping its history, and the step is run again. The alternative is a `/3` worker that also runs `/2` attempts on the old surface, keeping two tool surfaces in the code. This plan recommends the first.

**Assumptions:**
- "Prefer manufacturer datasheets" is delivered as opening-message guidance, like the Part description style, and doesn't change the digest-checked instructions.
- A protected name that resolves only to non-public addresses is skipped, because the address check already refuses those addresses. A protected name that resolves publicly, or fails to resolve, keeps today's behaviour: its addresses are refused, and a failed lookup refuses public fetches for that turn.
- Each guest management service accepts one browser origin. `vm:setup` provisions the origin `pnpm dev` will serve (tailnet when `INTAKE_DEV_TAILSCALE` is on, otherwise loopback), and reprovisions when it changes.
- Readiness exposes `web: available | unavailable` from the profile, not from a session's setting.

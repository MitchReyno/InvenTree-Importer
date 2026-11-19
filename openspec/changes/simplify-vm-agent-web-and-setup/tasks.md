# Implementation and delivery tasks

## Plan context

- [Proposal](proposal.md), [design assessment](design.md) and delta specs under `specs/` (`shared-vm-execution`, `processing-agent-sessions`, `app-settings`, `development-launcher`, `operations-backup-restore`).
- Reuse recommendation: extend the existing per-turn egress proxy and `guest_destinations.py`, orchestrate the existing bridge scripts, and label images with a content digest. No new runtime dependency.
- Change name: `simplify-vm-agent-web-and-setup`. Every branch and commit or PR subject includes it.
- Linked item: BI-017 in [`docs/PLANNED_FUNCTIONALITY.md`](../../../docs/PLANNED_FUNCTIONALITY.md). The index owns its current status.

## Completion and commit ordering

Complete and verify a checkbox action, then check it before committing that work, staging the `tasks.md` update in the same commit. Leave incomplete actions, and parents with open subtasks, unchecked. Review, publication, CI, live-run and merge actions stay unchecked until they have actually happened.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
| --- | --- | --- | --- |
| 1. Egress proxy public policy | Behaviour (tooling) | None | shared-vm-execution: Public destination checks; Protected names that don't resolve publicly |
| 2. Policy handoff and protected hosts | Behaviour (server and tooling) | Task 1 | shared-vm-execution: Egress applies the sealed web setting; Protected destinations come from the deployment; Scoped guest execution (Public web access off) |
| 3. Web settings, sealing and the opening message | Behaviour (contracts, server and frontend) | BI-016 merged; tasks 2 and 4 | app-settings: Agent settings section; Deferred settings; processing-agent-sessions: Web settings sealed per attempt; Opening message carries the session's web settings |
| 4. `shared-vm-agent/3` profile and retired `/2` attempts | Behaviour (server, migration and launcher) | Task 2 | processing-agent-sessions: Web tools run under a new VM profile version; Instructions describe the VM web tools; development-launcher: Processing switches select the profile |
| 5. Readiness web state | Behaviour (contracts, server and frontend) | Task 4 (the `/3` profile) | operations-backup-restore: Operations liveness and readiness |
| 6. Tool surface and admission | Behaviour (server) | Tasks 2 and 4 | shared-vm-execution: Claude and Codex VM tool surfaces; Host sessions keep no built-in tools |
| 7. `pnpm vm:setup` | Behaviour (tooling) | Task 1 (renamed egress file in the provisioning scripts) and task 11 (`browser-policy.sh`) | development-launcher: One-command VM setup; VM setup is safe to rerun; VM setup checks prerequisites and stops on failure |
| 8. Runner image freshness in `pnpm dev` | Behaviour (tooling) | Task 7 | development-launcher: The runner image is kept current; A failed image refresh stops startup; A missing pairing is refused before the VM starts |
| 9. Documentation | Documentation | Tasks 1–8 for the facts each document states | Docs match the specs. No retired settings or `bench-web` remain. |
| 10. Requalification run | Live verification | Tasks 1–9 and 11 merged; Mitch's fresh go-ahead | Provider behaviour behind the egress proxy; the `shared-vm-agent/3` profile qualified |
| 11. Remove the document reader | Behaviour (tooling) | Tasks 1 and 4 | shared-vm-execution: No separate document reader |

Only task 3 waits for BI-016. Tasks 1, 2, 4–9 and 11 can proceed while it is open. Until task 3 lands, `/3` attempts seal no web fields, so public web access stays off, while provider search already works.

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| Plan | This plan and the BI-017 entry | Planning artifacts only | Reviewable before any code | None | `interactive-app`, `docs/simplify-vm-agent-web-and-setup`, `docs(simplify-vm-agent-web-and-setup): plan simple web access and VM setup` | Strict OpenSpec validation, independent review |
| PR-A | Web policy in the per-turn egress proxy, delivered by the supervisor. The reader stays for `/2`. Public web access stays off until PR-C seals a value. | Tasks 1, 2 | One security boundary: proxy rules and the channel that feeds them, reviewed together | Plan merged | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-egress`, `feat(simplify-vm-agent-web-and-setup): enforce web policy at the turn egress` | `pnpm test:deployment`, `pnpm test:intake` and `pnpm test:intake:process`, `pnpm test:dev`, `pnpm lint`, guest smoke with the paired VM where available, exact-head review, green CI |
| PR-B | The `shared-vm-agent/3` profile with its tool surface and admission, retired `/2` attempts, the reader removed, and readiness reporting the web state | Tasks 4, 5, 6, 11 | The profile, its instructions and its tool surface must arrive together, or `/3` would run with tools its instructions don't match. The reader can only go once no launchable profile names it. Readiness reports what this PR makes true. | PR-A merged (`WebFetch` is always behind the policy) | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-tools`, `feat(simplify-vm-agent-web-and-setup): give VM agents web search and fetch` | `pnpm test:deployment`, `pnpm test:intake`, `pnpm test:intake:pg`, `pnpm test:intake:process`, `pnpm test:dev`, `pnpm test:frontend`, `pnpm lint:frontend`, `pnpm contracts:check`, runner image build, exact-head review, green CI |
| PR-C | Working web settings, sealed per attempt, and the opening message that reports them | Task 3 | Settings, sealing and what the session is told form one user-visible behaviour | BI-016 merged; PR-B merged | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-settings`, `feat(simplify-vm-agent-web-and-setup): add web research settings` | `pnpm test:intake`, `pnpm test:intake:pg`, `pnpm test:intake:process`, `pnpm test:frontend`, `pnpm lint:frontend`, `pnpm typecheck`, `pnpm build`, `pnpm contracts:check`, demo video (UI change), exact-head review, green CI |
| PR-D | One-command setup, image freshness and the documentation rewrite | Tasks 7, 8, 9 | Setup automation and the docs that replace the manual steps belong together | PR-A and PR-B merged; docs facts from PR-C merged first | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-vm-setup`, `feat(simplify-vm-agent-web-and-setup): add pnpm vm:setup` | `pnpm test:dev`, `pnpm lint`, Markdown checks, a recorded fresh `vm:setup` run, exact-head review, green CI |
| PR-E | Requalification evidence and notes | Task 10 | A live run is separate authority and evidence | PR-A to PR-D merged; Mitch's go-ahead | `interactive-app`, `docs/simplify-vm-agent-web-and-setup-qualification`, `docs(simplify-vm-agent-web-and-setup): record requalification` | Evidence attached to the PR, exact-head review |

## 1. Egress proxy public policy

- PR delivery: PR-A.
- Outcome: one proxy file enforces the provider allowlist and the public destination rules. The reader and `bench-web` keep working until task 11 removes them, because `/2` instructions still name `bench-web`.
- Scope and approach:
  - Rename `tooling/deployment/bridge/claude-egress.py` to `guest-egress.py`. Update its callers (`tool-turn.sh`, `personal-claude.sh`, `personal-codex.sh`, `runner.Dockerfile`) and its entry in the runner build-context whitelist, `runner.Dockerfile.dockerignore`.
  - Add the public branch (design D1): read the policy file, apply the `guest_destinations.py` checks, handle IPv4 and IPv6, connect to a checked address, and send refusal reasons in `X-Bench-Refusal`.
  - Move the resolution and skip rule for protected names into `guest_destinations.py`. The reader keeps using that module unchanged in behaviour.
  - Add `tests/test_guest_egress.py` and a root `test:deployment` script.
- Prerequisites: None.
- Acceptance: shared-vm-execution › Public destination checks (all scenarios); Protected names that don't resolve publicly (both scenarios).
- TDD approach:
  - The baseline is the existing reader tests passing.
  - RED: new egress tests expect public CONNECTs allowed with a policy, refusal reasons, IPv6 answers, port refusal and the skip rule. They fail against the provider-only proxy.
- Verification:
  - `pnpm test:deployment`, a new root script running `python3 -I -m unittest discover -s tooling/deployment/tests -p 'test_*.py'`, added to CI. The existing reader tests still pass.
  - `uv run --project backend ruff check --config backend/pyproject.toml tooling/deployment`, because `pnpm lint:backend` doesn't cover `tooling/deployment`.
  - Build the runner image once after the whitelist change, and record the result on the PR.
- Risks and decisions: the long-lived personal egress containers must keep working without a policy file, which a provider-only test covers.

- [x] 1.1 Run the existing reader and egress tests and record the baseline.
- [x] 1.2 RED: write `test_guest_egress.py` covering the cases below, and confirm they fail for the expected reason.
  - [x] 1.2.1 Provider hosts are allowed with and without a policy.
  - [x] 1.2.2 With web on, public hosts are allowed and the connection pins a checked address.
  - [x] 1.2.3 Mixed public and private answers, an IPv6 private answer, a private suffix, an IP literal and a port other than 443 are refused with their reasons.
  - [x] 1.2.4 A protected name, a subdomain of it and a shared address are refused, including a private-suffix protected name that resolves to a public address. A protected name resolving only privately is skipped. A failed lookup gives `resolution_failed` for public hosts only.
  - [x] 1.2.5 A missing or malformed policy file means provider-only.
- [x] 1.3 GREEN: implement `guest-egress.py` and the `guest_destinations.py` changes, and update the callers, image and whitelist.
- [x] 1.4 Add the `test:deployment` script and its CI step, then run it, the deployment `ruff check`, `pnpm lint` and a runner image build, and record the results.

## 2. Policy handoff and protected hosts

- PR delivery: PR-A.
- Outcome: each tool turn's egress proxy receives the sealed web setting and the deployment's protected hosts from the supervisor, through a channel the worker can't reach.
- Scope and approach:
  - **Tool turn:** `tool-turn.sh` creates `$turn/policy` and mounts it read-write in the peer and read-only in egress, not in the worker (design D2).
  - **Configuration handoff:** the launcher (`tooling/dev.cjs`) sets `INTAKE_AGENT_PROTECTED_ORIGINS` for the agent worker, and `session-worker-main.ts` validates it and gives it to `startSessionBridge()` (design D4).
  - **Coordinator:** `intake-server/src/agents/shared-vm/coordinator.ts` adds a `protected_hosts` command field from a new `protectedHosts()`, keeping public IP literals as protected addresses.
  - **Peer:** `guest-main.ts` validates the field and the optional manifest `web` object, then writes `policy.json` atomically before the worker turn.
  - **Input schema:** add the optional `web` object to the session input schema. It is absent, meaning off, until task 3.
  - **Retired setting:** the per-turn egress no longer receives `INTAKE_VM_PROTECTED_HOSTS` from `tool-turn.sh`. `public-web.sh`, the reader and the `tool-protected-hosts` file keep it until task 11.
- Prerequisites: task 1.
- Acceptance: shared-vm-execution › Egress applies the sealed web setting (both scenarios); Protected destinations come from the deployment; Scoped guest execution and tool access › Public web access off.
- TDD approach:
  - RED: coordinator tests expect `protected_hosts` worked out from the configured origins, keeping every DNS name (including private suffixes such as `.internal`) and public IP literals, and dropping non-public IP literals. A trailing-dot origin becomes the bare name, and a host that can't be represented refuses bridge start-up rather than being dropped.
  - RED: launcher tests expect the agent worker's `INTAKE_AGENT_PROTECTED_ORIGINS` to hold the loopback and inventory origins, plus the tailnet origin when `INTAKE_DEV_TAILSCALE` is on, while its `INTAKE_ORIGIN` stays loopback. A worker test expects `session_agent_configuration_required` when the list is missing or malformed.
  - RED: decoding a retained input with and without the `web` object.
  - RED: peer tests expect `policy.json` contents and refusal of invalid host lists.
  - RED: a `tool-turn.sh` argument test expects the policy mount absent from the worker's `docker run` arguments.
- Verification: `pnpm test:intake`, plus `pnpm test:intake:process` for the bridge and worker start-up; `pnpm test:dev` for the launcher passing the origin settings to the agent worker; `pnpm test:deployment` for the `tool-turn.sh` argument test; `tool-worker-smoke.sh` with the paired VM, showing a public `curl` refused while web is off. If the VM isn't available, record that limitation in the PR.
- Risks and decisions: the order of the policy write and the worker start matters. The peer writes before it calls the worker, and the test asserts that order.

- [x] 2.1 Read the coordinator command and peer validation paths, and record the current command shape.
- [x] 2.2 RED: add coordinator, peer and mount tests, and confirm the failures.
- [x] 2.3 GREEN: implement `protectedHosts()`, the command field, the input `web` schema, peer validation and the atomic write, and the mounts.
- [x] 2.4 Stop `tool-turn.sh` passing `INTAKE_VM_PROTECTED_HOSTS` to the per-turn egress, leaving the reader's configuration as it is. The existing reader tests, including public mode with protected hosts, still pass.
- [x] 2.5 Run `pnpm test:intake`, the tooling tests and, where available, the VM smoke test. Record the results and any VM limitation.

## 3. Web settings, sealing and the opening message

- PR delivery: PR-C.
- Outcome:
  - "Allow public web pages" and "Prefer manufacturer datasheets" work in Settings › Agents, default on, and are sealed into each attempt.
  - The opening message tells the session what it may do.
- Scope and approach:
  - **Contracts:** add both fields to the agent settings contract. The processing input's `web` object already exists from task 2.
  - **Server:** read the defaults as on, and seal in `processing/session-attempts.ts` (design D3) following the `part_description_style` pattern from BI-016.
  - **Opening message:** add the per-session lines in `agents/session/session-runner.ts`, where the description style goes (design D6).
  - **Frontend:** `AgentsSection` Web research subsection with the disclosure text and the disabled state for profiles without web access. Remove the item from the deferred list.
  - **Spec:** rebase the `app-settings` delta onto the merged BI-016 text first.
- Prerequisites: BI-016 merged; task 2 (the input field and egress policy); task 4 (the `/3` profile that seals web settings).
- Acceptance: app-settings › Agent settings section (Turning public web pages off, Profile without web access, Stale settings revision); Deferred settings are disabled and explained; processing-agent-sessions › Web settings sealed per attempt (both scenarios); Opening message carries the session's web settings (both scenarios).
- TDD approach:
  - RED: settings route tests for defaults and revision conflicts.
  - RED: session-attempt tests for sealing, a save while queued, and other profiles sealing off.
  - RED: decoding a retained input with and without the `web` object.
  - RED: session-runner tests for the opening text with web on, web off and the preference, with the instruction digest unchanged across settings.
  - RED: frontend tests for the switches, disabled state, save and conflict.
- Verification: `pnpm test:intake`, `pnpm test:intake:pg` (attempt sealing against PostgreSQL), `pnpm test:intake:process` (session runner), `pnpm test:frontend`, `pnpm lint:frontend`, `pnpm typecheck`, `pnpm build`, `pnpm contracts:check`. A demo video goes on the PR.
- Risks and decisions: BI-016 may change the input version or the settings shape. Adapt to it, and record the departure in `notes.md`.

- [ ] 3.1 Rebase the `app-settings` delta and this task's approach onto the merged BI-016, and record any differences in `notes.md`.
- [ ] 3.2 RED: add the contract, settings, sealing, opening-message and frontend tests, and confirm the failures.
- [ ] 3.3 GREEN: implement the contract fields, defaults, sealing, the opening-message lines and the Settings subsection.
- [ ] 3.4 Run `pnpm test:intake`, `pnpm test:intake:pg`, `pnpm test:intake:process`, `pnpm test:frontend`, `pnpm lint:frontend`, `pnpm typecheck`, `pnpm build` and `pnpm contracts:check`, and record the demo video for the PR.

## 4. `shared-vm-agent/3` profile and retired `/2` attempts

- PR delivery: PR-B.
- Outcome:
  - VM tool sessions run under a new `shared-vm-agent/3` profile, whose fixed instructions describe search, `WebFetch` and `curl`.
  - Any `/2` attempt that reaches a `/3` worker, whether queued or requeued by a resume, fails with `agent_profile_retired`, and its history is kept.
- Scope and approach:
  - **Profile:** a new additive migration adds the `shared-vm-agent/3` row (instructions, digest, tool profile `native-session-web-tools/1`) and extends the version-pair check, leaving `0026` and the `/2` row untouched (design D10). The launcher's profile table (`tooling/dev/profile.cjs`) and the profile literals in contracts, server and guest code accept `/3`.
  - **Retired attempts:** the session runner settles a `/2` attempt before its profile-mismatch guard (`session-runner.ts:445-455`), so neither a fresh claim nor a resume requeued by `queueSessionResume()` (`:280`) can wait forever.
  - **Digests:** add the `/3` digest fixture. The `/2` digest fixture stays unchanged.
- Prerequisites: task 2. Delivered with task 6, so `/3` never runs without its tool surface.
- Acceptance: processing-agent-sessions › Web tools run under a new VM profile version (all scenarios); Instructions describe the VM web tools (Host session); development-launcher › Processing switches select the profile (Profile table).
- TDD approach:
  - RED PostgreSQL tests: the migration adds `/3` with its digest and leaves `/2` byte-identical; a retained `/2` attempt still decodes; a queued `/2` attempt and a finished `/2` session receiving a new message both settle as `agent_profile_retired`.
  - RED session-runner test: no web text for `native-agent/2`.
  - RED launcher test: tools true selects `/3`.
- Verification: `pnpm test:intake`, `pnpm test:intake:pg` (migration and retained attempts), `pnpm test:intake:process` (session runner), `pnpm test:dev` (profile table).
- Risks and decisions: Mitch confirms the retired-attempt behaviour before implementation (proposal, open decisions). Task 10 qualifies the new profile.

- [x] 4.1 Confirm the retired-attempt behaviour with Mitch.
- [x] 4.2 RED: add the migration, retained-attempt, resume, session-runner and launcher tests, and confirm the failures.
- [x] 4.3 GREEN: add the migration, the profile literals, the launcher mapping, the retired-attempt handling and the instruction text.
- [x] 4.4 Run `pnpm test:intake`, `pnpm test:intake:pg`, `pnpm test:intake:process` and `pnpm test:dev`, and record the results.

## 5. Readiness web state

- PR delivery: PR-B.
- Outcome: readiness and the local setup diagnostics report whether sessions have web access, instead of `research: unqualified`.
- Scope and approach: `contracts/src/live.ts`, `operations/readiness.ts`, the `web_ready` log in `main.ts`, and `frontend/src/components/operations/Diagnostics.tsx` (design D7). Update the snapshot fixtures that carry `research`.
- Prerequisites: task 4.
- Acceptance: operations-backup-restore › Operations liveness and readiness (all scenarios).
- TDD approach: RED readiness tests for `shared-vm-agent/3` (`web: available`) and `synthetic-session/1` (`web: unavailable`), plus a Diagnostics component test.
- Verification: `pnpm test:intake`, `pnpm test:frontend`, `pnpm lint:frontend`, `pnpm contracts:check`.
- Risks and decisions: none.

- [x] 5.1 RED: add the readiness and diagnostics tests, and confirm the failures.
- [x] 5.2 GREEN: replace the field in contracts, server and frontend.
- [x] 5.3 Run the intake, frontend and contract checks, and record the results.

## 6. Tool surface and admission

- PR delivery: PR-B.
- Outcome: Claude VM sessions get `Glob`, `Grep`, `TodoWrite`, `WebSearch` and `WebFetch`. Codex VM sessions get live web search with the proxy set in their shell environment. Host sessions are unchanged.
- Scope and approach:
  - **Claude:** update `session-adapters.ts` (builtins and the in-turn check) and `claude-session-admission.ts`.
  - **Codex:** update `session-admission.ts` (`requireCodexSessionConfig`, the `ADMISSION_POLICY` bump), the Codex guest config including `shell_environment_policy.set`, and `requireAppItem`.
  - The design reference is D5.
- Prerequisites: task 2, so `WebFetch` and `curl` always pass through the policy, and task 4, which adds the `/3` profile this surface belongs to.
- Acceptance: shared-vm-execution › Claude VM tool surface; Codex VM tool surface; Host sessions keep no built-in tools (all scenarios).
- TDD approach: RED admission and adapter tests using recorded init frames and config reads: new tool lists admitted, extra tools refused, `webSearch` items accepted, `native-agent/2` still refused with web search on, and the old admission marker giving resume unavailable.
- Verification: `pnpm test:intake` (the intake server runs `tsx --test`).
- Risks and decisions: Codex `shell_environment_policy.set` must show up in `config/read`. If it doesn't, record that in `notes.md` and verify the variable with the smoke test instead.

- [x] 6.1 Record the current recorded frames and config fixtures used by the admission tests.
- [x] 6.2 RED: add admission and adapter tests for each case, and confirm the failures.
- [x] 6.3 GREEN: update the tool lists, the Codex config, the admission checks, the item check and the policy identity.
- [x] 6.4 Run `pnpm test:intake` and record the results.

## 7. `pnpm vm:setup`

- PR delivery: PR-D.
- Outcome: one rerunnable command prepares the images, VM, pairing, operator key and guest services (design D8).
- Scope and approach:
  - Add `tooling/dev/vm-setup.cjs` and the root script `vm:setup`, reusing `tooling/dev/settings.cjs` and `vm.cjs`.
  - Make `personal-claude.sh` and `personal-codex.sh` replace only their own containers and leave state alone.
  - Run `browser-policy.sh` as a setup step.
  - Check the operator key on both sides before provisioning, and make `personal-claude.sh` and `personal-codex.sh` refuse to generate or overwrite a key when the guest already has one (design D8). Shell tests cover the scripts on their own.
  - Add pairing detection around `pair.sh`.
- Prerequisites: tasks 1 and 11.
- Acceptance: development-launcher › One-command VM setup; VM setup is safe to rerun; VM setup checks prerequisites and stops on failure (all scenarios).
- TDD approach: RED tests in `tooling/tests/dev-vm-setup.test.cjs` with an injected `exec`, as in `dev-vm.test.cjs`, covering:
  - a fresh run in order;
  - a rerun with no actions;
  - a one-sided pairing giving `vm_pairing_mismatch`;
  - a stopped guest service being started, and a failed start stopping the run naming it;
  - a one-sided or mismatched operator key giving `vm_operator_key_mismatch`, with neither key written;
  - a missing `limactl`;
  - a failed step stopping the run;
  - the VM stop rules;
  - an origin change reprovisioning.
- Verification: `pnpm test:dev` (with the new `tooling/tests/dev-vm-setup.test.cjs` added to that script), `pnpm lint:tooling`, and one recorded `pnpm vm:setup` run plus a rerun, with output attached to the PR. The run is isolated:
  - a disposable VM name (`INTAKE_VM_NAME=bench-agent-setup-test`);
  - a new temporary `INTAKE_DEV_STATE`, so the pairing and operator key default inside it;
  - a new guest directory.

  The real `bench-agent-m1-local` VM, its pairing and Mitch's state directory are not touched.
- Risks and decisions: image builds take minutes, so the tests never build for real.

- [ ] 7.1 Read `tooling/tests/dev-vm.test.cjs` and record the injected `exec` shape to reuse.
- [ ] 7.2 RED: add the setup tests, and confirm the failures.
- [ ] 7.3 GREEN: implement `vm-setup.cjs`, the script entry and the provisioning script changes.
- [ ] 7.4 Run the tests and lint, then the isolated run and rerun. Attach the output to the PR, then delete only the disposable VM and the temporary state directory.

## 8. Runner image freshness in `pnpm dev`

- PR delivery: PR-D.
- Outcome: `pnpm dev` refreshes a stale runner image before starting the relays, warns when the VM is unmanaged, and points the missing-pairing refusal at `pnpm vm:setup` (design D9).
- Scope and approach: a digest helper shared with task 7; the launcher's VM start path in `tooling/dev/vm.cjs` and `tooling/dev.cjs`; the `vm_pairing_missing` message.
- Prerequisites: task 7.
- Acceptance: development-launcher › The runner image is kept current; A failed image refresh stops startup; A missing pairing is refused before the VM starts (all scenarios).
- TDD approach: RED launcher tests for a matching digest (no build), a mismatch (rebuild, load, `browser-policy.sh` and restart before the relays), a `.dockerignore` change invalidating the digest, a stale image with a missing or mismatched host key stopping with `vm_operator_key_mismatch` and leaving both keys unchanged, a load that succeeded followed by failed provisioning being repaired on the next start before any relay, a guest service on an old image ID or the wrong origin, a stopped guest service being started before the relays, a missing or changed browser policy, a failed rebuild (`vm_runner_image_refresh_failed` and the stop rules), unmanaged (warning only), and the refusal text naming `pnpm vm:setup`.
- Verification: `pnpm test:dev` and `pnpm lint:tooling`.
- Risks and decisions: the digest input list must include everything the image copies. A test asserts the list against the Dockerfiles' `COPY` sources.

- [ ] 8.1 RED: add the digest and launcher tests, including the `COPY` source coverage test, and confirm the failures.
- [ ] 8.2 GREEN: implement the digest helper, the label at build time, and the launcher check.
- [ ] 8.3 Run the tests and lint, and record the results.

## 9. Documentation

- PR delivery: PR-D.
- Outcome: the docs describe the new setup and web access, and nothing mentions retired pieces.
- Scope and approach:
  - Root `README.md` VM section reduced to prerequisites, `pnpm vm:setup`, two switches and sign-in, with a note for existing setups.
  - `docs/development.md`, including the `INTAKE_VM_AGENT_TOOLS` line.
  - The `tooling/deployment/README.md` shared-VM section.
  - `.env.example`.
  - `intake-server/src/agents/ARCHITECTURE.md`, about the reader and egress.
- Prerequisites: tasks 1–8 and 11 for the facts.
- Acceptance: every doc claim matches the merged code and specs. No `bench-web`, reader or retired web setting is left.
- TDD approach: documentation only. Verify with reference searches and Markdown checks instead of tests.
- Verification: `pnpm lint:markdown`, `pnpm format:check`, the reference search from task 11, and a read-through against the specs.
- Risks and decisions: none.

- [ ] 9.1 Rewrite the affected sections.
- [ ] 9.2 Run the reference search, `pnpm lint:markdown` and `pnpm format:check`, and fix any findings.

## 10. Requalification run

- PR delivery: PR-E.
- Outcome: the `shared-vm-agent/3` profile is qualified with the new tool surface and egress policy on both providers.
- Scope and approach: a live Examine and Research session on Claude and on Codex, each with web on and then off. Record:
  - `WebSearch` and `web_search` results;
  - `WebFetch` through the proxy;
  - a `curl` PDF download;
  - refusals for a private target and with web off.
- Prerequisites: PR-A to PR-D merged; Mitch's fresh go-ahead for the live provider run.
- Acceptance: the provider-dependent risks in the design are confirmed or recorded as limitations.
- TDD approach: not applicable to a live run. The evidence is the recorded session outcome per case.
- Verification: session transcripts summarised on the PR, without secrets; `notes.md` updated with any provider host or preflight finding.
- Risks and decisions: a provider needing an extra host means a follow-up policy change, not an ad-hoc allowlist edit during the run.

- [ ] 10.1 Ask Mitch for the go-ahead for the live run.
- [ ] 10.2 Run each case and record the outcomes.
- [ ] 10.3 Update `notes.md` and the PR with the results and any limitations.

## 11. Remove the document reader

- PR delivery: PR-B.
- Outcome: the reader, `bench-web` and `public-web.sh` are gone in the same release that makes `/3` the selected profile and retires `/2`. No launchable profile is left instructing agents to use a missing tool.
- Scope and approach:
  - Replace `public-web.sh` with `browser-policy.sh`, which only installs `guest/browser-seccomp.json` into the guest directory, as `public-web.sh:8-9` does today. Until PR-D, the README points to it in place of `public-web.sh`.
  - Delete `web-reader.py`, `bench-web`, the `bench-web` install line in `runner.Dockerfile`, their `runner.Dockerfile.dockerignore` entries, and the reader socket check and `/run/web` mount in `tool-turn.sh`.
  - Retire `INTAKE_VM_PROTECTED_HOSTS` and the `tool-protected-hosts` file, which only the reader still uses.
  - Move the reader's remaining useful policy cases into `test_guest_egress.py`, and delete `test_web_reader.py`.
- Prerequisites: tasks 1 and 4, delivered in the same PR as task 4.
- Acceptance: shared-vm-execution › No separate document reader.
- TDD approach: RED tests that fail before the removal:
  - every profile the launcher can select has stored instructions that don't mention `bench-web`;
  - a `tool-turn.sh` argument test expects no `/run/web` mount and no reader socket check.
- Verification:
  - `pnpm test:deployment`, `pnpm test:dev` and `pnpm test:intake:pg`.
  - A runner image build.
  - With the paired VM where available, Chromium starts in a tool worker with the policy that `browser-policy.sh` installed. Record the result, or the VM limitation, on the PR.
  - `rg -n 'bench-web|web-reader|public-web|reader.sock' --glob '!openspec/changes/archive/**' --glob '!intake-server/migrations/**'` returns only planning text and the retained `/2` handling. Applied migrations are immutable and keep their historical text.
- Risks and decisions: none beyond task 4's retired-attempt decision.

- [x] 11.1 RED: add the launchable-profile instruction test and the `tool-turn.sh` argument test, and confirm the failures.
- [x] 11.2 GREEN: add `browser-policy.sh`, remove the reader files, install line, whitelist entries, socket check and mount, and move the remaining reader test cases.
- [x] 11.3 Run the checks, the image build, the Chromium check where the VM is available and the reference search, and record the results.

## Delivery evidence and lifecycle follow-up

For each bundle, record the reviewed commit, check results and published or merged state only after they exist:

- [ ] Plan PR: independent exact-head review clean; PR published; merged.
- [ ] PR-A: exact-head review clean; CI green; merged.
- [ ] PR-B: exact-head review clean; CI green; merged.
- [ ] PR-C: exact-head review clean; CI green; merged.
- [ ] PR-D: exact-head review clean; CI green; merged.
- [ ] PR-E: exact-head review clean; merged.

Keep `notes.md` current, attach evidence to PR descriptions rather than committing it, and update BI-017's status as evidence arrives. Done needs the merged implementation and the requalification evidence. Sync and archive only when authorized, then update the index link.

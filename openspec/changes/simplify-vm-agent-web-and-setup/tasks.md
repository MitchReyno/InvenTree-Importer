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
| 1. Egress proxy public policy and reader removal | Behaviour (tooling) | None | shared-vm-execution: Public destination checks; Protected names that don't resolve publicly; No separate document reader |
| 2. Policy handoff and protected hosts | Behaviour (server and tooling) | Task 1 | shared-vm-execution: Egress applies the sealed web setting; Protected destinations come from the deployment; Scoped guest execution (Public web access off) |
| 3. Web settings and sealing | Behaviour (contracts, server and frontend) | BI-016 merged; task 2 | app-settings: Agent settings section; Deferred settings; processing-agent-sessions: Web settings sealed per attempt |
| 4. Web guidance in instructions and the opening message | Behaviour (server) | Task 3 | processing-agent-sessions: Instructions describe the VM web tools; Opening message carries the session's web settings |
| 5. Readiness web state | Behaviour (contracts, server and frontend) | None | operations-backup-restore: Operations liveness and readiness |
| 6. Tool surface and admission | Behaviour (server) | Task 2 | shared-vm-execution: Claude and Codex VM tool surfaces; Host sessions keep no built-in tools |
| 7. `pnpm vm:setup` | Behaviour (tooling) | Task 1 (renamed egress file in the provisioning scripts) | development-launcher: One-command VM setup; VM setup is safe to rerun; VM setup checks prerequisites and stops on failure |
| 8. Runner image freshness in `pnpm dev` | Behaviour (tooling) | Task 7 | development-launcher: The runner image is kept current; A failed image refresh stops startup; A missing pairing is refused before the VM starts |
| 9. Documentation | Documentation | Tasks 1–8 for the facts each document states | Docs match the specs. No retired settings or `bench-web` remain. |
| 10. Requalification run | Live verification | Tasks 1–9 merged; Mitch's fresh go-ahead | Provider behaviour behind the egress proxy; the `shared-vm-agent/2` profile requalified |

Tasks 5 and 7 have no dependency on the settings work, so they can proceed while BI-016 is open.

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| Plan | This plan and the BI-017 entry | Planning artifacts only | Reviewable before any code | None | `interactive-app`, `docs/simplify-vm-agent-web-and-setup`, `docs(simplify-vm-agent-web-and-setup): plan simple web access and VM setup` | Strict OpenSpec validation, independent review |
| PR-A | Web policy in the per-turn egress proxy, delivered by the supervisor; reader removed. Web stays off until PR-B seals a value. | Tasks 1, 2 | One security boundary: proxy rules and the channel that feeds them, reviewed together | Plan merged | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-egress`, `feat(simplify-vm-agent-web-and-setup): enforce web policy at the turn egress` | Python policy tests, intake-server tests, `pnpm lint`, guest smoke with the paired VM where available, exact-head review, green CI |
| PR-B | Working web settings, sealed per attempt, and the guidance agents receive | Tasks 3, 4 | Settings, sealing and what the session is told form one user-visible behaviour | BI-016 merged; PR-A merged | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-settings`, `feat(simplify-vm-agent-web-and-setup): add web research settings` | Contracts, intake-server and frontend tests, typecheck, build, demo video (UI change), exact-head review, green CI |
| PR-C | New provider tool surface, and readiness reporting the web state | Tasks 5, 6 | The tool surface is what makes "web available" true. Both touch admission or the live contract. | PR-A merged (so `WebFetch` is always behind the policy) | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-tools`, `feat(simplify-vm-agent-web-and-setup): give VM agents web search and fetch` | Admission and adapter tests, contract tests, frontend tests, exact-head review, green CI |
| PR-D | One-command setup, image freshness and the documentation rewrite | Tasks 7, 8, 9 | Setup automation and the docs that replace the manual steps belong together | PR-A merged; docs facts from PR-B and PR-C merged first | `interactive-app`, `feat/simplify-vm-agent-web-and-setup-vm-setup`, `feat(simplify-vm-agent-web-and-setup): add pnpm vm:setup` | `tooling/dev` tests, `pnpm lint`, Markdown checks, a recorded fresh `vm:setup` run, exact-head review, green CI |
| PR-E | Requalification evidence and notes | Task 10 | A live run is separate authority and evidence | PR-A to PR-D merged; Mitch's go-ahead | `interactive-app`, `docs/simplify-vm-agent-web-and-setup-qualification`, `docs(simplify-vm-agent-web-and-setup): record requalification` | Evidence attached to the PR, exact-head review |

## 1. Egress proxy public policy and reader removal

- PR delivery: PR-A.
- Outcome: one proxy file enforces the provider allowlist and the public destination rules. The reader, `bench-web` and their setup are gone.
- Scope and approach:
  - Rename `tooling/deployment/bridge/claude-egress.py` to `guest-egress.py` and update its callers (`tool-turn.sh`, `personal-claude.sh`, `personal-codex.sh`, `runner.Dockerfile`).
  - Add the public branch (design D1): read the policy file, apply the `guest_destinations.py` checks, handle IPv4 and IPv6, connect to a checked address, and send refusal reasons in `X-Bench-Refusal`.
  - Move the resolution and skip rule for protected names into `guest_destinations.py`.
  - Delete `web-reader.py`, `bench-web`, `public-web.sh`, the `bench-web` install line in `runner.Dockerfile`, and the reader socket check and `/run/web` mount in `tool-turn.sh`.
  - Port `tests/test_web_reader.py` to `tests/test_guest_egress.py`.
- Prerequisites: None.
- Acceptance: shared-vm-execution › Public destination checks (all scenarios); Protected names that don't resolve publicly; No separate document reader.
- TDD approach:
  - The baseline is the existing reader tests passing.
  - RED: new egress tests expect public CONNECTs allowed with a policy, refusal reasons, IPv6 answers, port refusal and the skip rule. They fail against the provider-only proxy.
- Verification: `python3 -I -m unittest tooling/deployment/tests/test_guest_egress.py`; `pnpm lint:backend` covers Python style; `rg -n 'bench-web|web-reader|public-web|reader.sock' --glob '!openspec/changes/archive/**'` returns only planning text.
- Risks and decisions: the long-lived personal egress containers must keep working without a policy file. Covered by a provider-only test.

- [ ] 1.1 Run the existing reader and egress tests and record the baseline.
- [ ] 1.2 RED: write `test_guest_egress.py` covering the cases below, and confirm they fail for the expected reason.
  - [ ] 1.2.1 Provider hosts are allowed with and without a policy.
  - [ ] 1.2.2 With web on, public hosts are allowed and the connection pins a checked address.
  - [ ] 1.2.3 Mixed public and private answers, an IPv6 private answer, a private suffix, an IP literal and a port other than 443 are refused with their reasons.
  - [ ] 1.2.4 A protected name, a subdomain of it and a shared address are refused. A protected name resolving only privately is skipped. A failed lookup gives `resolution_failed` for public hosts only.
  - [ ] 1.2.5 A missing or malformed policy file means provider-only.
- [ ] 1.3 GREEN: implement `guest-egress.py` and the `guest_destinations.py` changes, and update the callers and image.
- [ ] 1.4 Remove the reader files, the `bench-web` install, and the socket check and mount. Port the remaining reader tests and delete the reader test file.
- [ ] 1.5 Run the Python tests, `pnpm lint` and the reference search, and record the results.

## 2. Policy handoff and protected hosts

- PR delivery: PR-A.
- Outcome: each tool turn's egress proxy receives the sealed web setting and the deployment's protected hosts from the supervisor, through a channel the worker can't reach.
- Scope and approach:
  - **Tool turn:** `tool-turn.sh` creates `$turn/policy` and mounts it read-write in the peer and read-only in egress, not in the worker (design D2).
  - **Coordinator:** `intake-server/src/agents/shared-vm/coordinator.ts` adds a `protected_hosts` command field from a new `protectedHosts()` (design D4).
  - **Peer:** `guest-main.ts` validates the field and the optional manifest `web` object, then writes `policy.json` atomically before the worker turn.
  - **Input schema:** add the optional `web` object to the session input schema. It is absent, meaning off, until task 3.
  - **Retired setting:** `INTAKE_VM_PROTECTED_HOSTS` is no longer read.
- Prerequisites: task 1.
- Acceptance: shared-vm-execution › Egress applies the sealed web setting (both scenarios); Protected destinations come from the deployment; Scoped guest execution and tool access › Public web access off.
- TDD approach:
  - RED: coordinator tests expect `protected_hosts` worked out from the configured URLs, skipping IP literals and loopback.
  - RED: peer tests expect `policy.json` contents and refusal of invalid host lists.
  - RED: a `tool-turn.sh` argument test expects the policy mount absent from the worker's `docker run` arguments.
- Verification: `pnpm test:intake`; the shell argument test under `tooling/deployment/tests`; `tool-worker-smoke.sh` with the paired VM, showing a public `curl` refused while web is off. If the VM isn't available, record that limitation in the PR.
- Risks and decisions: the order of the policy write and the worker start matters. The peer writes before it calls the worker, and the test asserts that order.

- [ ] 2.1 Read the coordinator command and peer validation paths, and record the current command shape.
- [ ] 2.2 RED: add coordinator, peer and mount tests, and confirm the failures.
- [ ] 2.3 GREEN: implement `protectedHosts()`, the command field, the input `web` schema, peer validation and the atomic write, and the mounts.
- [ ] 2.4 Remove `INTAKE_VM_PROTECTED_HOSTS` handling and the `tool-protected-hosts` file.
- [ ] 2.5 Run `pnpm test:intake`, the tooling tests and, where available, the VM smoke test. Record the results and any VM limitation.

## 3. Web settings and sealing

- PR delivery: PR-B.
- Outcome: "Allow public web pages" and "Prefer manufacturer datasheets" work in Settings › Agents, default on, and are sealed into each attempt.
- Scope and approach:
  - **Contracts:** add both fields to the agent settings contract and the processing input (`web` object).
  - **Server:** read the defaults as on, and seal in `processing/session-attempts.ts` (design D3) following the `part_description_style` pattern from BI-016.
  - **Frontend:** `AgentsSection` Web research subsection with the disclosure text and the disabled state for profiles without web access. Remove the item from the deferred list.
  - **Spec:** rebase the `app-settings` delta onto the merged BI-016 text first.
- Prerequisites: BI-016 merged; task 2.
- Acceptance: app-settings › Agent settings section (Turning public web pages off, Profile without web access, Stale settings revision); Deferred settings are disabled and explained; processing-agent-sessions › Web settings sealed per attempt (both scenarios).
- TDD approach:
  - RED: settings route tests for defaults and revision conflicts.
  - RED: session-attempt tests for sealing, a save while queued, and other profiles sealing off.
  - RED: frontend tests for the switches, disabled state, save and conflict.
- Verification: `pnpm test:intake`, `pnpm test:frontend`, `pnpm typecheck`, `pnpm build`, `pnpm contracts:check`. A demo video goes on the PR.
- Risks and decisions: BI-016 may change the input version or the settings shape. Adapt to it, and record the departure in `notes.md`.

- [ ] 3.1 Rebase the `app-settings` delta and this task's approach onto the merged BI-016, and record any differences in `notes.md`.
- [ ] 3.2 RED: add the contract, settings, sealing and frontend tests, and confirm the failures.
- [ ] 3.3 GREEN: implement the contract fields, defaults, sealing and the Settings subsection.
- [ ] 3.4 Run the full intake and frontend checks, `pnpm typecheck`, `pnpm build` and `pnpm contracts:check`, and record the demo video for the PR.

## 4. Web guidance in instructions and the opening message

- PR delivery: PR-B.
- Outcome: VM tool sessions are told how to use search, `WebFetch` and `curl`, and whether this session may read public pages, with the datasheet preference.
- Scope and approach:
  - **Fixed instructions:** add the web paragraph for `shared-vm-agent/2` only in `agents/session/session-runner.ts`.
  - **Opening message:** add the per-session lines in the same place the description style goes (design D6).
  - **Digest:** update that profile's expected instruction digest.
- Prerequisites: task 3.
- Acceptance: processing-agent-sessions › Instructions describe the VM web tools (Host session); Opening message carries the session's web settings (both scenarios).
- TDD approach: RED session-runner tests for the opening text with web on, web off and the preference, an unchanged digest across settings, and no web text for `native-agent/2`.
- Verification: `pnpm test:intake`.
- Risks and decisions: the profile digest changes, which is expected. Task 10 requalifies.

- [ ] 4.1 RED: add session-runner tests for each case, and confirm the failures.
- [ ] 4.2 GREEN: add the fixed paragraph and the opening-message lines, and update the digest fixture.
- [ ] 4.3 Run `pnpm test:intake` and record the results.

## 5. Readiness web state

- PR delivery: PR-C.
- Outcome: readiness and the local setup diagnostics report whether sessions have web access, instead of `research: unqualified`.
- Scope and approach: `contracts/src/live.ts`, `operations/readiness.ts`, the `web_ready` log in `main.ts`, and `frontend/src/components/operations/Diagnostics.tsx` (design D7). Update the snapshot fixtures that carry `research`.
- Prerequisites: None.
- Acceptance: operations-backup-restore › Operations liveness and readiness (all scenarios).
- TDD approach: RED readiness tests for `shared-vm-agent/2` (`web: available`) and `synthetic-session/1` (`web: unavailable`), plus a Diagnostics component test.
- Verification: `pnpm test:intake`, `pnpm test:frontend`, `pnpm contracts:check`.
- Risks and decisions: none.

- [ ] 5.1 RED: add the readiness and diagnostics tests, and confirm the failures.
- [ ] 5.2 GREEN: replace the field in contracts, server and frontend.
- [ ] 5.3 Run the intake, frontend and contract checks, and record the results.

## 6. Tool surface and admission

- PR delivery: PR-C.
- Outcome: Claude VM sessions get `Glob`, `Grep`, `TodoWrite`, `WebSearch` and `WebFetch`. Codex VM sessions get live web search with the proxy set in their shell environment. Host sessions are unchanged.
- Scope and approach:
  - **Claude:** update `session-adapters.ts` (builtins and the in-turn check) and `claude-session-admission.ts`.
  - **Codex:** update `session-admission.ts` (`requireCodexSessionConfig`, the `ADMISSION_POLICY` bump), the Codex guest config including `shell_environment_policy.set`, and `requireAppItem`.
  - The design reference is D5.
- Prerequisites: task 2, so `WebFetch` and `curl` always pass through the policy.
- Acceptance: shared-vm-execution › Claude VM tool surface; Codex VM tool surface; Host sessions keep no built-in tools (all scenarios).
- TDD approach: RED admission and adapter tests using recorded init frames and config reads: new tool lists admitted, extra tools refused, `webSearch` items accepted, `native-agent/2` still refused with web search on, and the old admission marker giving resume unavailable.
- Verification: `pnpm test:intake` (the intake server runs `tsx --test`).
- Risks and decisions: Codex `shell_environment_policy.set` must show up in `config/read`. If it doesn't, record that in `notes.md` and verify the variable with the smoke test instead.

- [ ] 6.1 Record the current recorded frames and config fixtures used by the admission tests.
- [ ] 6.2 RED: add admission and adapter tests for each case, and confirm the failures.
- [ ] 6.3 GREEN: update the tool lists, the Codex config, the admission checks, the item check and the policy identity.
- [ ] 6.4 Run `pnpm test:intake` and record the results.

## 7. `pnpm vm:setup`

- PR delivery: PR-D.
- Outcome: one rerunnable command prepares the images, VM, pairing, operator key and guest services (design D8).
- Scope and approach:
  - Add `tooling/dev/vm-setup.cjs` and the root script `vm:setup`, reusing `tooling/dev/settings.cjs` and `vm.cjs`.
  - Make `personal-claude.sh` and `personal-codex.sh` replace only their own containers and leave state alone.
  - Add pairing detection around `pair.sh`.
- Prerequisites: task 1.
- Acceptance: development-launcher › One-command VM setup; VM setup is safe to rerun; VM setup checks prerequisites and stops on failure (all scenarios).
- TDD approach: RED tests in `tooling/tests/dev-vm-setup.test.cjs` with an injected `exec`, as in `dev-vm.test.cjs`, covering:
  - a fresh run in order;
  - a rerun with no actions;
  - a one-sided pairing giving `vm_pairing_mismatch`;
  - a missing `limactl`;
  - a failed step stopping the run;
  - the VM stop rules;
  - an origin change reprovisioning.
- Verification: `pnpm test:dev` (with the new `tooling/tests/dev-vm-setup.test.cjs` added to that script), `pnpm lint:tooling`, and one recorded `pnpm vm:setup` run on a disposable VM name (`INTAKE_VM_NAME=bench-agent-setup-test`) plus a rerun, with output attached to the PR. The real `bench-agent-m1-local` VM and its pairing are not touched.
- Risks and decisions: image builds take minutes, so the tests never build for real.

- [ ] 7.1 Read `tooling/tests/dev-vm.test.cjs` and record the injected `exec` shape to reuse.
- [ ] 7.2 RED: add the setup tests, and confirm the failures.
- [ ] 7.3 GREEN: implement `vm-setup.cjs`, the script entry and the provisioning script changes.
- [ ] 7.4 Run the tests and lint, then the disposable-VM run and rerun. Attach the output to the PR, and delete the disposable VM afterwards.

## 8. Runner image freshness in `pnpm dev`

- PR delivery: PR-D.
- Outcome: `pnpm dev` refreshes a stale runner image before starting the relays, warns when the VM is unmanaged, and points the missing-pairing refusal at `pnpm vm:setup` (design D9).
- Scope and approach: a digest helper shared with task 7; the launcher's VM start path in `tooling/dev/vm.cjs` and `tooling/dev.cjs`; the `vm_pairing_missing` message.
- Prerequisites: task 7.
- Acceptance: development-launcher › The runner image is kept current; A failed image refresh stops startup; A missing pairing is refused before the VM starts (all scenarios).
- TDD approach: RED launcher tests for a matching digest (no build), a mismatch (rebuild, load and restart before the relays), a failed rebuild (`vm_runner_image_refresh_failed` and the stop rules), unmanaged (warning only), and the refusal text naming `pnpm vm:setup`.
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
- Prerequisites: tasks 1–8 for the facts.
- Acceptance: every doc claim matches the merged code and specs. No `bench-web`, reader or retired web setting is left.
- TDD approach: documentation only. Verify with reference searches and Markdown checks instead of tests.
- Verification: `pnpm lint:markdown`, `pnpm format:check`, the reference search from task 1, and a read-through against the specs.
- Risks and decisions: none.

- [ ] 9.1 Rewrite the affected sections.
- [ ] 9.2 Run the reference search, `pnpm lint:markdown` and `pnpm format:check`, and fix any findings.

## 10. Requalification run

- PR delivery: PR-E.
- Outcome: the `shared-vm-agent/2` profile is requalified with the new tool surface and egress policy on both providers.
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

## Delivery evidence and lifecycle follow-up

For each bundle, record the reviewed commit, check results and published or merged state only after they exist:

- [ ] Plan PR: independent exact-head review clean; PR published; merged.
- [ ] PR-A: exact-head review clean; CI green; merged.
- [ ] PR-B: exact-head review clean; CI green; merged.
- [ ] PR-C: exact-head review clean; CI green; merged.
- [ ] PR-D: exact-head review clean; CI green; merged.
- [ ] PR-E: exact-head review clean; merged.

Keep `notes.md` current, attach evidence to PR descriptions rather than committing it, and update BI-017's status as evidence arrives. Done needs the merged implementation and the requalification evidence. Sync and archive only when authorized, then update the index link.

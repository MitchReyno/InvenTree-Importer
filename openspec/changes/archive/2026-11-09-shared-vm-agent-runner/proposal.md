# Shared VM agent runner and portable deployment

## Problem and intended outcome

A personal Bench Intake installation should run concurrent Claude Code and Codex sessions with working shells, scripts, image tools and a browser while keeping its application host and inventory services outside the agent execution environment. Deploy the same ARM64 application and runner image digests to an M1 Mac and Raspberry Pi 5. Each installation owns one persistent Linux worker VM shared by its agents.

## Change identity and linked items

Canonical change: `shared-vm-agent-runner`. No matching item in the current planned-functionality index. This proposal is for the requested personal deployment.

## Current behavior and evidence

The driver call in `intake-server/src/agents/session-runner.ts` already separates a claimed turn from execution. The adapters launch local children, enforce tool admission and expect a loopback MCP server. The repository's live qualification recorded Codex tools appearing despite disabled configuration (see `openspec/changes/harden-native-agent-sessions/notes.md`). The worker owns database credentials that must stay outside agent execution. Agent Settings stores revisioned provider selection and concurrency, and has no secret store. The existing decoder image and development InvenTree Compose stack solve narrower packaging problems.

## Scope and non-goals

Deliver a host Compose deployment, guest Compose deployment, VM provisioning configuration, guest execution profile, targeted cancellation, resume and two provider-specific settings flows. Preserve existing host and synthetic profiles and the separate human Apply boundary. Sessions share a kernel and personal trust domain. Multi-tenant credential brokerage, cloud compute, automatic inventory writes and migrating real installations are outside scope.

## Reuse and dependency assessment

| Option | Fit | Cost and decision |
| --- | --- | --- |
| [Lima](https://lima-vm.io/docs/config/vmtype/) with Docker in one guest | Native Mac virtualization and Linux QEMU/KVM, ordinary OCI images, reusable guest | Select. Qualify Linux ARM64 on the actual Pi, pin tested releases and verify mounts and firewall policy. |
| [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/install/) | Agent kits and VM lifecycle | Raspberry Pi OS falls outside its published Ubuntu matrix. Its additional lifecycle service buys little for one shared VM. |
| [QEMU directly](https://www.qemu.org/docs/master/system/introduction.html) | ARM64 with HVF or KVM | Useful diagnostic fallback. Owning disks, boot and provisioning increases maintenance. |
| Existing worker, MCP, contracts and OCI tooling | Preserve claims, evidence grants and fenced mutations | Add a narrow authenticated runner protocol. Moving the whole database-backed worker into the guest would grant unnecessary authority. |

Research checked 2026-11-08. Base image and CLI redistribution terms, pinned ARM64 packages and real-device performance must be checked before publishing release images. Use an operator-built image or install the unmodified provider executable at provisioning if redistribution is unavailable.

## Capabilities

### New capabilities

- `shared-vm-execution` covers the deployment, execution bridge and personal credential management.

### Modified capabilities

- `provider-runtime` admits guest-only Claude setup-token and Codex device login under the new profile. Existing local profile checks continue to apply.

## Impact and dependencies

Affects frontend Agent Settings, shared contracts, processing and provider workers, image builds and operator documentation. Requires an authenticated personal deployment, persistent guest storage and reachable virtualization hardware. Independent changes to settings and provider admission must be reconciled before implementation.

## Open decisions and assumptions

Lima is the proposed provisioner. Raspberry Pi 5 KVM availability, memory budget and safe concurrency require physical qualification. No live sign-in or billing test has been performed for this proposal.

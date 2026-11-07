# Change proposal

## Problem and intended outcome

Native sessions must provide usable, citable proposals without gaining tools outside the intake boundary. BI-006 live qualification found Codex executing JavaScript around MCP calls, Claude exposing a deferred advisor, opaque proposal errors and missing citation digests for newly delivered evidence. Harden these boundaries and repeat qualification before considering removal of `native_unverified`.

## Change identity and linked items

Canonical name: `harden-native-agent-sessions`. Linked item: [BI-010](../../../docs/PLANNED_FUNCTIONALITY.md#bi-010--harden-native-agent-sessions). The index owns status and priority. Delivering branches and subjects retain this change name.

## Current behavior and evidence

`intake-server/src/agents/session-adapters.ts` checks Codex MCP inventory, not the complete model tool surface. Its item checks cannot establish that nested MCP calls were not wrapped in arbitrary JavaScript. Claude checks its init list, which previously omitted deferred advisor tooling. `tools/handlers.ts` reduces contract errors to `invalid_contract`; evidence fetch paths return images without a complete source citation. See the task 13 findings in [the archived notes](../archive/2026-11-07-simplify-intake-entry/notes.md) and [qualification PR](https://github.com/MitchReyno/InvenTree-Importer/pull/118). Those observations are historical, not a claim about newly installed provider versions.

## Scope and non-goals

Also expose categorized failures with a clickable Show details control in Processing and session history, including safe retained debug information. Cover native-agent/2 tool admission on start and resume, actionable proposal errors, citable mid-session evidence and repeatable qualification including chat handling. Preserve the four previously accepted Codex inert exceptions, explicitly documenting the discrepancy with the main spec's absolute tool prohibition. No broader built-in exception is permitted. Do not change /1, implement general host sandboxing, fix development launchers, alter inventory authority, add providers or solve multi-worker routing. Planning authorizes no live inference; the BI-010 index explicitly requires fresh authorization.

## Reuse and dependency assessment

Inspected repository manifests and lockfile on 2026-11-07: MCP server/client 2.4.0, node transport 2.1.2; Ajv 8.20.0 and TypeBox 0.34.52. Reuse the existing adapters, MCP transport, contracts validator and process lifecycle rather than replace the session runtime.

| Option and relevant version | Goal fit and strengths | Limitations and cost | Primary evidence checked 2026-11-07 | Proof of fit |
| --- | --- | --- | --- | --- |
| Existing native adapters; historical Codex 0.166.0 and Claude 2.1.318 | Preserves subscription authentication, resume and scoped MCP integration | CLI versions and deferred tools can change; configuration alone is insufficient evidence | [Codex configuration reference](https://developers.openai.com/codex/config-reference), [Claude CLI reference](https://code.claude.com/docs/en/cli-reference), session-adapters.ts | Verify exact executable configuration and complete offered surface using a local no-inference protocol probe before admitting that version |
| Existing Ajv 8.20.0 | Already owns schema validation and exposes structured error paths; no new dependency or schema duplication | Errors must be copied immediately and sanitized; union errors require bounded summaries | [Ajv API](https://ajv.js.org/api.html), contracts/package.json and contracts/src/index.ts | Contract tests for missing fields, nested paths and hostile values |
| Replace native CLIs with direct model API orchestration | Application can own the complete tool declaration | Loses native subscription/resume compatibility and introduces a new orchestration and authentication boundary | Existing native-session ownership and authentication contracts | Rejected for this change; not an equivalent drop-in replacement |

No new package is proposed. Retain the installed licensing and security baseline; new CLI versions require their own compatibility review. A validation-message package cannot own session authority or citation provenance; a generic MCP client cannot attest provider built-ins. Custom code is limited to adapter admission policy, redacted diagnostic projection and authoritative citation assembly. Documentation research does not prove confinement.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `processing-agent-sessions`: complete tool admission with explicit inert Codex exceptions, correctable proposal diagnostics, authoritative fetched citations and qualification criteria.

## Impact and dependencies

Owners are frontend Processing/session-history views, contracts and intake-server agents/tools, with process and PostgreSQL tests. Generated contracts change additively. An additive diagnostic-record migration may be needed; retain existing session history and tolerate older records without details. BI-006 is merged; provider CLI proof of fit and authorized live qualification are remaining external dependencies. Keep `native_unverified` until the complete supported matrix passes; never infer qualification from stub tests.

## Open decisions and assumptions

Retain the established four Codex exceptions only when their inert behavior is demonstrated: list_mcp_resources, list_mcp_resource_templates, read_mcp_resource and request_user_input. The delta makes this explicit instead of silently contradicting the main spec. Unknown or uninspectable callable surfaces fail closed. If a native CLI cannot support this admission boundary, report it unsupported and keep qualification pending rather than replace the runtime or weaken policy. Exact CLI flags are an implementation proof-of-fit task, not an asserted discovery. Qualification is scoped to recorded provider/model/auth/version combinations; fresh live-run authorization remains outstanding.

## Investigation continuation

This change owns both the investigation and its continuation. Once a suitable confinement avenue is selected, expand this same `harden-native-agent-sessions` change with the findings, selected approach, any additional behavioral requirements, detailed design, implementation tasks and revised PR delivery map. Do not move that follow-on work into a separate change or treat the investigation alone as completion. Keep new implementation actions unchecked until performed. Update the plan before implementing the selected approach; this continuation does not itself authorize live provider usage.

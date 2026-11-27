# Offline native session probes

These scripts run the installed native CLI against loopback model and MCP stubs with fake credentials and a disposable home. They do not perform live inference or prove subscription entitlement. Use the pinned Node version and installed intake-server dependencies. They derive from the archived simplify-intake-entry probes; the support module uses the installed MCP v2 Standard Schema interface.

Run from the repository root. Keep stdout/stderr in ignored local artifacts and attach redacted evidence to the delivering PR; never commit probe output.

```sh
SPIKE_EXTRA_CONFIG='{"features.code_mode.enabled":false,"skills.include_instructions":false}' node intake-server/scripts/native-session-probe/codex.cjs
SPIKE_EXTRA_CONFIG='{"features.code_mode.enabled":true}' node intake-server/scripts/native-session-probe/codex.cjs
SPIKE_EXTRA_CONFIG='{"features.code_mode.enabled":true,"features.code_mode.direct_only_tool_namespaces":["mcp__intake"]}' node intake-server/scripts/native-session-probe/codex.cjs
SPIKE_OMIT_CODE_MODE=1 SPIKE_EXTRA_CONFIG='{"features.code_mode.enabled":true}' node intake-server/scripts/native-session-probe/codex.cjs
SPIKE_ONLY='subscription-shaped flags,env expansion + allowlist,persist then resume' node intake-server/scripts/native-session-probe/claude.cjs
```

`SPIKE_CODEX_EXECUTABLE` and `SPIKE_CLAUDE_EXECUTABLE` select an explicit executable. `SPIKE_RESUME_EXTRA_CONFIG` overrides Codex configuration only on the resumed process, for upgrade compatibility checks. `SPIKE_PRIVATE_HOME=1` probes a different HOME under the synthetic working tree; this alone does not remove ancestor-discovered skills. The planted skill marker is synthetic.

Inspect fresh and resumed request tool lists, actual MCP call receipts, planted-skill visibility and effective configuration. The Codex probe fails if required round trips or MCP inventory fail. A successful script exit alone does not qualify confinement: enabled-code-mode negative controls deliberately expose additional tools. Claude's subscription-shaped flags still use a fake API key and do not reproduce the actual subscription request. Deferred placeholders or provider server tools require separate interpretation, not an automatic pass.

Each process has a 60-second outer deadline and its children are killed on exit. The stub captures request shapes and tool names; results may contain temporary filesystem paths and synthetic conversation text. Never point the model endpoint at a live service or inject real provider credentials.

The selected offline policy pins Codex 0.166.0 and Claude 2.1.319. Codex requires both disabled code mode and disabled skill instructions. Claude uses an empty built-in tool set, strict MCP configuration, empty setting sources, disabled slash commands and the intake allowlist; API-key turns additionally use bare mode. Unknown versions are refused by production admission. All live provider/model/authentication combinations remain native_unverified.

For Claude controls, `SPIKE_CLAUDE_ARGS` is a JSON array of extra flags, `SPIKE_CLAUDE_BARE=0` tests non-bare fresh/resume, and `SPIKE_TOOL_CALL=DeferredToolPlaceholder` deliberately calls the deferred placeholder from the stub. Inspect the returned no-such-tool result and unchanged tool surface; its description alone is not evidence of inert behavior.

`SPIKE_CONTROL_INIT=1` sends initialize and mcp_status control requests before user input, including a second status read after startup. `SPIKE_WAIT_FOR_INIT=1` separately tests whether the ordinary system/init frame is available before input; it is not the admission gate. Production uses the control handshake with a 15-second deadline and only sends text after the connected inventory passes.

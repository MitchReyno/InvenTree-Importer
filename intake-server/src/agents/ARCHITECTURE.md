# Native agent integration

Native agent sessions reuse Processing attempts, currentness, actor lanes, human questions and retained proposals. This first profile is `native-agent/1` with immutable input/command/envelope version 4 and handler `processing/4`. Earlier fixture formats and instruction bytes remain unchanged. Native support is labelled `native_unverified`: deterministic protocol tests do not establish actual inference, account access or host containment.

## Defaults and session history

One settings row belongs to the configured operator, target and target context, and applies across batches and stages. No billable model is selected implicitly. Expected-revision writes preserve concurrent edits. Each new native attempt reads the settings under a shared transaction lock and seals the exact provider, authentication mode, requested model and settings revision in its immutable input. Default changes neither rewrite nor invalidate an existing attempt.

The separate session table stores timestamps, the native session identifier, resolved model and one bounded progress phase. Processing owns lifecycle, cancellation and physical lane occupancy. Session reads join scoped command authority and retained attempt state in one bounded query. The `latest_on_job` field describes selected attempt identity, not evidence freshness. Opening the batch uses the owning Processing currentness/provenance checks before exposing actionable results; history grants no suggestion authority. History is paginated by queue time and attempt ID. The browser displays lifecycle and metadata; accepted suggestions and questions remain in the owning batch view. Raw provider streams, stderr, credentials and private reasoning are not retained or published.

## Provider boundary

`codex.ts` uses the installed Codex app-server over stdio JSON-RPC. API-key mode uses a fixed OpenAI Responses endpoint and an environment-key provider, without persisting the key through a login RPC. Its separate `codex-api` home never opens the subscription login store. Subscription mode reads the CLI's existing native account using a dedicated application Codex home. The operator signs in directly; the application never copies an authentication store. Effective sandbox, approval policy and provider must match the requested route before a turn starts.

`claude.ts` invokes the unmodified Claude Code CLI in headless stream-JSON mode. Subscription mode requires a pre-existing first-party host CLI login. API-key mode uses bare mode to avoid keychain authentication; subscription mode cannot use bare mode. Both use safe mode, an empty built-in tool set, strict empty MCP configuration and explicit settings-source exclusion. The only permitted CLI structured-output tool is `StructuredOutput`. There is no model or authentication fallback.

Children receive an allowlisted host environment, one selected provider's key when requested, and explicit staged context. They never inherit application database credentials, private runner channels, inventory credentials, alternate API endpoints, provider OAuth environment tokens or proxy settings. Native host administration and provider-managed policy remain trusted deployment boundaries; they have not been qualified through live inference here.

## Evidence and outcomes

The coordinator verifies retained input/command authority and command media pins before materializing evidence. Native requests contain retained notes and up to eight exact authorized JPEG/PNG/WebP image versions with a combined eight MiB limit. Hashes and byte sizes are verified after owning media reads. PDF originals and unsupported or over-budget versions are explicitly listed as unavailable. The agent must ask the operator when available evidence is insufficient; it cannot cite unavailable content. PDF page rendering into native requests and external semantic broker tools are follow-up work.

Structured results contain exactly one proposal or one human question. Shared contracts validate shapes; the adapter additionally restricts citations to evidence actually delivered, and Processing validates subject/provenance/currentness before accepting an envelope. Suggestions never select human values or grant apply authority. Stage names grant no additional tools. This profile has no shell, filesystem, web, arbitrary MCP, inventory-write or approval tools.

## Supervision and recovery

The web process only registers settings/history routes and queues Processing commands. It never launches a CLI or starts inference on page load or settings save. A separately started worker delivers the existing durable outbox to the pinned DBOS queue, with bounded concurrency and no inference retry. A per-actor PostgreSQL advisory lock prevents duplicate native supervisors.

Streams have bounded frames, total output, stderr, runtime and process-group reap deadlines. Cancellation, supersession and shutdown abort the active adapter. The child group is terminated, escalated when needed and confirmed absent before a terminal envelope can release the lane. An unconfirmed reap keeps the lane occupied.

A worker restart refuses an occupied lane and never revives a native session or permission callback. After an abrupt supervisor/host failure, inspect the retained session and confirm termination of its original process tree before using the existing explicit Processing interruption maintenance seam. This first version deliberately provides no browser button that asserts physical termination. A server restart alone cannot prove a billable call stopped.

## Configuration

Provision a separate runner role with `grantProcessing(..., 'runner')`, and a scheduler role on the owned local PostgreSQL database. Apply reviewed migrations explicitly. The API role receives settings write/session insert access; the runner can read settings and update only session progress metadata. Neither role can rewrite a sealed native selection.

Set the following on the separate worker; do not load the original inventory environment file:

- `INTAKE_PROCESSING_PROFILE=native-agent/1` on both web and worker.
- Matching actor, target, target-context and Processing channel-secret configuration.
- `INTAKE_AGENT_DATABASE_URL` and `INTAKE_AGENT_SCHEDULER_DATABASE_URL`, both explicit local databases.
- `INTAKE_AGENT_STATE_ROOT`, an absolute, private directory owned by the worker user. Session directories are retained.
- Optional `INTAKE_CODEX_EXECUTABLE` and `INTAKE_CLAUDE_EXECUTABLE`; defaults are `codex` and `claude` on the worker PATH.
- Optional `INTAKE_BLOB_ROOT` for authorized image content; absent storage is explicitly unavailable evidence.
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` only for the selected API-key route. API-key variables are omitted from subscription child environments.

For Codex subscription, create the private `codex` directory beneath the state root and run `CODEX_HOME="$INTAKE_AGENT_STATE_ROOT/codex" codex login` as the worker user. Keep that dedicated home free of configuration, hooks, plugins and skills; preflight refuses them. For Claude subscription, use `claude auth login` as the host worker user. Never export or copy subscription tokens.

Start the worker with `pnpm --filter @invimport/intake-server agents:run`, then save a provider/authentication/model default in Agent settings. Start work explicitly from a batch's Processing controls. Keep worker and web supervision separate. Stopping either process is not an inventory rollback.

## Qualification

Official protocol documentation and offline CLI help/schema were inspected for Codex 0.166.0 and Claude Code 2.1.316. Controlled executable tests cover API-key/subscription branches, malformed and oversized frames, tool refusal and a child that ignores SIGTERM. Real PostgreSQL/process checks cover queue-time selection, grants, history, duplicate supervisor fencing and end-to-end DBOS delivery to a deterministic CLI. These are implementation checks only. Actual provider calls remain prohibited in this development session, so live login, entitlement, structured-output compatibility and host containment remain unverified.

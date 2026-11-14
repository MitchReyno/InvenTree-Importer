# provider-runtime Specification

## Purpose

Provider usage is gated and supervised outside the web process. This capability covers the gates shared by both agent workers and the single-result `native-agent/1` runner: explicit worker startup, one supervisor per actor, a saved default, the selected authentication route, an allowlisted child environment, tool refusal, staged evidence and bounded, reaped child processes. The session tool boundary, resume and slots of `native-agent/2` are specified by processing-agent-sessions. Native support stays labelled `native_unverified`: these requirements describe what the code enforces, not live provider behavior.

## Requirements

### Requirement: Provider web process never launches inference

The web process SHALL only register Agent settings, session history and Processing routes and queue durable commands. In an enabled personal VM deployment it MAY relay authenticated operator credential-management requests to the paired runner without starting inference. It MUST NOT import or launch an agent worker, a provider CLI or the session tool server, whether on startup, page load, settings save or a Processing start.

#### Scenario: Save an agent default

- **GIVEN** the web process running with a native profile and no agent worker
- **WHEN** the operator saves a provider, authentication and model default
- **THEN** the settings are stored and no provider process is started.

#### Scenario: Start work with no worker running

- **GIVEN** no agent worker running
- **WHEN** the operator starts Processing for a lot
- **THEN** the attempt and its command are queued and stay queued; no inference happens until a separately started worker claims the command.

### Requirement: Provider worker startup gates

Each agent worker SHALL be a separately started process that refuses to start unless its matching processing profile and channel secret are configured, its database and scheduler URLs are loopback PostgreSQL, its agent state root is an absolute directory owned by the worker user with no group or other access and no symbolic link, and the database schema is compatible. Refusals SHALL report only a fixed safe code.

#### Scenario: Remote database

- **GIVEN** an agent database URL that is not on 127.0.0.1, localhost or ::1
- **WHEN** the worker starts
- **THEN** it stops with `local_agent_database_required` before connecting.

#### Scenario: Shared state directory

- **GIVEN** an agent state root readable by other users
- **WHEN** the worker starts
- **THEN** it stops with `private_agent_state_required`.

#### Scenario: Incompatible schema

- **GIVEN** a database whose schema version the worker does not support
- **WHEN** the worker starts
- **THEN** it stops with `database_version_quarantined` and claims no work.

### Requirement: Provider single supervisor per actor

An agent worker SHALL hold a per-actor PostgreSQL advisory lock for its whole run, so a second supervisor for the same actor MUST fail with `agent_supervisor_already_running`. A worker SHALL also refuse to start with `agent_reap_confirmation_required` while that actor's Processing lane or any session slot is still occupied, and losing the lock SHALL stop the worker.

#### Scenario: Second supervisor

- **GIVEN** a running native worker for an actor
- **WHEN** another worker starts for the same actor, even with no queued work
- **THEN** it stops with `agent_supervisor_already_running`.

#### Scenario: Restart with an occupied lane

- **GIVEN** a lane still held by an attempt from a worker that stopped abruptly
- **WHEN** a worker starts
- **THEN** it stops with `agent_reap_confirmation_required` and tells the operator to confirm the old process tree is gone before recovering the lane.

### Requirement: Provider default sealed at queue time

No provider or model SHALL be selected implicitly: queuing a `native-agent/1` attempt without a saved Agent settings default MUST fail with `agent_default_required`. Each attempt SHALL seal the provider, authentication mode, model and settings revision it read, and later default changes SHALL neither rewrite nor invalidate it. Settings writes SHALL compare the expected revision and fail with `revision_conflict` (412) when it moved on.

#### Scenario: No default saved

- **GIVEN** the `native-agent/1` profile and no saved Agent settings
- **WHEN** the operator starts Processing
- **THEN** the start fails with `agent_default_required` and nothing is queued.

#### Scenario: Default changed after queuing

- **GIVEN** a queued attempt sealed with Codex and model M
- **WHEN** the default changes to Claude
- **THEN** the queued attempt still runs with Codex and model M, and only new attempts use Claude.

### Requirement: Provider authentication route without fallback

A native attempt SHALL use only its sealed authentication route, with no fallback to another route, provider or model. For the shared VM profile only, a sealed Claude subscription turn MAY use a configured operator setup-token as its exclusive credential and a Codex subscription turn MAY use the guest’s managed ChatGPT login. Without the credential required by the sealed route, the attempt SHALL settle `waiting_for_login` without starting a turn.

#### Scenario: Route-specific invocation

- **GIVEN** attempts sealed for each provider and route
- **WHEN** their children are started
- **THEN** Codex API-key mode uses the fixed OpenAI Responses endpoint provider, Claude API-key mode runs bare, subscription mode never runs bare, and Codex subscription mode requires a ChatGPT account in the dedicated Codex home.

#### Scenario: Claude subscription not signed in

- **GIVEN** an attempt sealed for Claude subscription using native CLI login
- **WHEN** the CLI's auth status is not a claude.ai first-party login
- **THEN** no turn starts and the attempt settles `waiting_for_login`.

#### Scenario: API key missing

- **GIVEN** an attempt sealed for Codex API key and no `OPENAI_API_KEY` in the worker environment
- **WHEN** the worker runs it
- **THEN** no child is started and the attempt settles `waiting_for_login`.

#### Scenario: Personal runner receives a revoked setup-token

- **WHEN** Claude rejects the configured subscription credential
- **THEN** the runner reports authentication required and never retries using an API key or cached account.

### Requirement: Provider child environment allowlist

For existing host profiles a provider child SHALL receive only `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `SHELL`, `SYSTEMROOT`, a private `TMPDIR`, a dedicated `CODEX_HOME` for Codex, and the selected key only in API-key mode. It MUST NOT receive application, channel or inventory credentials, proxies, alternate endpoints or OAuth tokens, and a customised Codex home SHALL be refused.

#### Scenario: Hostile parent environment

- **GIVEN** a worker environment that also holds a database URL, a proxy, an alternate API base URL and an OAuth token
- **WHEN** a provider child is started
- **THEN** none of them reach the child.

#### Scenario: Customised Codex home

- **GIVEN** a dedicated Codex home containing `config.toml`
- **WHEN** a Codex attempt starts
- **THEN** it is refused with `agent_home_customizations_refused` before the app server is launched.

#### Scenario: Shared VM token isolation

- **WHEN** a shared VM provider process starts
- **THEN** the runner explicitly injects the configured setup token only for the selected Claude subscription route and strips unrelated credentials and endpoints.

### Requirement: Provider tool and policy refusal

A `native-agent/1` turn SHALL use no tool other than Claude's `StructuredOutput`, under a restricted invocation for each provider. The adapter SHALL refuse the turn on any other tool use, a different effective approval, sandbox or provider, any server-initiated request such as a native permission request, or an unexpected item type.

#### Scenario: Restricted invocation

- **GIVEN** a `native-agent/1` attempt
- **WHEN** its child is started
- **THEN** Claude Code runs with safe mode, an empty built-in tool set, a strict empty MCP configuration, no settings sources and no session persistence, and Codex runs with approval policy never, a read-only sandbox without network, web search off and the shell, image, apps, plugins, memories, multi-agent and permission-request features off.

#### Scenario: Codex starts an unexpected tool

- **GIVEN** a Codex turn in progress
- **WHEN** the app server reports a tool item starting
- **THEN** the adapter refuses with `agent_tool_refused` before any tool output is used, and the attempt settles failed.

#### Scenario: Claude reports a tool

- **GIVEN** a Claude turn
- **WHEN** its init message lists a tool other than `StructuredOutput`
- **THEN** the adapter refuses with `agent_tool_refused`.

### Requirement: Provider staged evidence and single result

A native request SHALL contain the sealed input's notes and at most eight command-pinned JPEG, PNG or WebP versions totalling at most 8 MiB, each verified for size and SHA-256 after reading it through the owning media boundary. PDF originals and unsupported or over-budget versions SHALL be listed as unavailable. The result SHALL be exactly one proposal or one question, and a proposal citing a source that was not delivered SHALL fail the attempt.

#### Scenario: PDF and nine photos

- **GIVEN** a lot with a PDF and nine small photos
- **WHEN** its native request is staged
- **THEN** eight photos are sent as images, and the PDF and the ninth photo are listed as unavailable.

#### Scenario: Malformed or ambiguous result

- **GIVEN** a turn whose output is malformed, oversized, or holds both or neither of a proposal and a question
- **WHEN** the adapter decodes it
- **THEN** the turn is refused and the attempt is not shown as a successful session.

### Requirement: Provider bounded supervision and reap

Provider children SHALL be bounded to 256 KiB per frame, 2 MiB output, 128 KiB stderr and 5 minutes, and SHALL be aborted when the attempt's durable state, polled every 500 ms, stops being running. An aborted child's process group SHALL be killed and confirmed absent before settlement, with no inference retry and no retained raw output.

#### Scenario: Outcome mapping

- **GIVEN** a native attempt that is aborted, hits a login failure, or fails otherwise
- **WHEN** the runner settles it
- **THEN** it settles `interrupted`, `waiting_for_login` or `failed` respectively, the DBOS step is not retried, and raw stdout, stderr and credentials are neither retained nor published.

#### Scenario: Reap not confirmed

- **GIVEN** a child process group still present at the end of the 2-second reap deadline, after SIGKILL escalation
- **WHEN** the adapter closes it
- **THEN** a reap-pending error is raised and the lane stays held.

#### Scenario: Child ignores SIGTERM

- **GIVEN** a running child that ignores SIGTERM
- **WHEN** its job is cancelled
- **THEN** the process group is killed, its absence is confirmed before the terminal envelope is sent, and the lane is then released.

#### Scenario: Backpressured input

- **GIVEN** a child that stops reading its stdin
- **WHEN** the attempt is cancelled while a write is blocked
- **THEN** the write is interrupted and the child is reaped before the adapter returns.

### Requirement: Provider runner qualification labels

A runner SHALL declare a qualification that matches its profile: `native_unverified` for `native-agent/1` and `fixture_only` for `synthetic-research/2` and `restricted-research-stub/1`. A runner whose declared qualification does not match SHALL be refused with `unsupported_runner_profile` (422) before any claim.

#### Scenario: Fixture runner presented as native

- **GIVEN** a runner declaring `fixture_only` for the `native-agent/1` profile
- **WHEN** it is asked to execute a command
- **THEN** it is refused with `unsupported_runner_profile` and no attempt is claimed.

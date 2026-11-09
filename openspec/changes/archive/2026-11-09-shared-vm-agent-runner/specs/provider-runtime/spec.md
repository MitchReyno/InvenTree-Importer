## MODIFIED Requirements

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

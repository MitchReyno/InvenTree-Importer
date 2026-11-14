# Design assessment

## Context and grounding

The coordinator claims and settles turns in PostgreSQL. The current driver calls local Claude or Codex adapters. Its tool endpoint uses loopback and a per-attempt capability. AgentSettingsForm and the settings repository use revision checks. Place the process boundary at the session driver and keep the existing application-side decisions over source citations, questions and proposals.

## Goals and constraints

One VM per installation contains all agent execution. The trust boundary protects the application and host. Sessions under the same guest user can access each other's files or process credentials. Write-only describes the settings interface. It cannot protect a token after compromise of its provider process or guest. This design assumes one operator. The guest can send material it has received to permitted public destinations.

## Decisions and alternatives

### Two Docker contexts

Ship host and guest Compose manifests, a pinned Lima template with automatic host mounts disabled, and a release manifest of compatible ARM64 digests. Host services share an application image with separate entrypoints and roles. Build the static frontend, generated contracts, server dependencies, migrations and required Python importer into the appropriate runtime stages. Keep the media decoder separate. Give its trusted dispatcher a fixed decoder-launch operation; keep engine sockets out of API, Apply and agent containers. Use persistent volumes for databases, blobs, guest state and provider homes. Exclude local imports, environment files, credentials and caches from build contexts.

Preserve loopback-only DB and HTTP-origin validation through a deliberate deployment network configuration, such as sharing a private network namespace with the database listener for database clients. Specify and test the exact scheme before shipping; globally widening loopback checks is unacceptable. Use a same-origin authenticated reverse proxy for the personal UI and preserve CSRF and websocket origin checks. A dev actor header or bare LAN access is insufficient authorization to change credentials.

### Guest runner protocol

The guest supervisor opens a mutually authenticated encrypted connection to the coordinator. Pair its identity with the personal installation and actor. Bind each dispatch to attempt, turn and an immutable command digest. Journal acceptance before spawning, attach to an existing execution on duplicate delivery, and retain uncertain launches for explicit reconciliation. A guest restart compares journal, supervisor boot identity and surviving process scopes. Require confirmed termination of all descendants before release. Use a process scope with enforceable resource limits and bounded stream frames. Apply backpressure independently per session. Compatibility negotiation must fail closed for unsupported protocol or guest releases.

Use the existing attempt capability on the bridge and revalidate authority at the host on every tool call. Deliver admitted evidence bytes through bounded chunks with a digest to a guest-generated safe path. Maintain original-version citation grants. Install shell, Python, Node, image/PDF tools and headless Chromium in the guest. Provide a fresh per-session browser profile. Enforce egress at the VM network boundary: permit public browsing and the specific paired bridge, block host/LAN/tailnet, link-local and metadata destinations after DNS resolution, redirects and on IPv6. No arbitrary callback destinations, privileged guest containers, host storage shares or inventory credentials.

### Operator credentials

Add dedicated authenticated secret mutation commands, isolated from ordinary settings autosave. Accept a bounded, nonempty token only over TLS or an explicitly loopback-local UI. Disable request-body capture and error echoes across the proxy, API and runner. Relay to the paired guest in memory; store with atomic replacement in a private credential volume owned by the supervisor. Track a nonsecret generation, request ID and presence; handle lost acknowledgements by querying that generation. Clear form state on completion and navigation. Save, Replace and Remove require an explicit operator action. Removing a local token prevents future use but cannot revoke an already issued credential at Anthropic; drain active Claude turns before reporting removal effective. Verify scope with a synthetic sentinel in each provider/auth combination. Inject the token only into the selected Claude process and strip it from tool environments where supported. Shared-user process inspection remains a residual risk. See [Anthropic setup tokens](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).

For personal Codex use a dedicated guest CODEX_HOME and the native app-server device flow. Send account/login/start with type chatgptDeviceCode. Show the returned verificationUrl and userCode only to the requesting operator, bind loginId to the current worker and expire pending state. Accept account/login/completed only for that ID and confirm the expected auth mode via account/read. Support account/login/cancel and disconnect/logout; serialize credential changes against active use. Device login must be enabled in the user's security settings or by the workspace admin. Display connected separately from a successfully completed subscription-backed inference. OpenAI also documents app-owned OAuth for eligible open-source apps, but that adds client registration, token rotation and a loopback callback; native device login suits a phone controlling a Pi. [App-server authentication](https://developers.openai.com/codex/app-server#authentication) and [Codex authentication](https://developers.openai.com/codex/auth).

## Verification strategy

Use stub executables and disposable databases first. Exercise duplicate delivery, cancellation with descendants, reconnect, stale capabilities, settings conflicts, secret redaction and replacement of containers. On each target run identical image digests, compare host/guest boot identities, start two sessions in the same guest, crop synthetic evidence, browse a controlled public fixture and cancel one while the other continues. Measure peak RAM, disk use and app response time on the Pi. Record a supported slot count from measurements. Test phone device login and entitlement separately with operator-authorized live accounts.

## Migration, rollout and recovery

Introduce an opt-in versioned profile. Seal it at queue time; drain old attempts under their original adapters. Refuse to adopt a conversation across incompatible admission profiles. Release images and VM configuration together, with service-specific secrets and explicit migrations. Rollback by stopping new claims, reconciling active turns and selecting the previous compatible release. Preserve volumes, never auto-restore an older schema or replay an uncertain turn. Update architecture, deployment and recovery docs with the delivering changes.

## Risks and open decisions

Confirm exact Pi OS, KVM permissions, storage and RAM before claiming support. Select a tested native CLI build and verify management RPC compatibility, Linux credential persistence and simultaneous refresh before release. Distribution to other operators requires a separate provider terms assessment; this credential feature is scoped to the user's own deployment.

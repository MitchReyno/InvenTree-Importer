# 6. Security and operations

[Design index](README.md) · Proposed operational controls and release gates.

## Deployment baseline

Start on **the persistent InvenTree host**, with HTTPS access from phone/desktop. Put built React assets and the TypeScript API behind one reverse proxy, explicitly supervise workers and retain private durable media locally.

Create a separate Bench Intake database and restricted role in the existing PostgreSQL instance. Keep migrations, credentials and backups separate; do not query InvenTree tables. Sharing the instance shares contention, outage and maintenance risk. Bound pools/resources without altering InvenTree infrastructure as part of this design.

Package app/workers reproducibly. Keep the personal native provider runner on its supported own-computer route. If the host/OS cannot support it, leave research unavailable; do not copy credentials or assume container/remote deployment is permitted.

```diagram
Public/LAN: HTTPS only
        │
┌───────▼────────────── operator-controlled host ───────────────────┐
│ proxy ─► TypeScript API/static app                               │
│ TypeScript API + coordinator ─────► Bench Intake DB               │
│ serial apply process ────────────► Bench Intake DB                │
│ serial apply ── delegated HTTP ──► InvenTree API                   │
│ InvenTree API ───────────────────► InvenTree DB                    │
│                                                                 │
│ Existing PostgreSQL instance:                                   │
│   [Bench Intake DB: product + journal] [InvenTree DB]             │
│ Separate roles; no Bench Intake process accesses InvenTree DB    │
│ TypeScript API/media jobs ───────► private blobs                  │
│ research-runner ─────────────────► provider service               │
│ Native login, staged job files, no apply credential              │
└─────────────────────────────────────────────────────────────────┘
```

No serverless/edge deployment for the apply lane: it needs durable state, process ownership and controlled long-running work. Initial supported OS, filesystem durability and native runtime versions are a release decision, not a cross-platform promise. If the app moves to another host, use the explicit move/restore procedure and separately qualify runner delivery. Do not expose DBOS administration, PostgreSQL, private blob directories or native app-server ports publicly.

## Authentication and authorization

### Identity setup

Use a qualified supported InvenTree identity integration and maintained protocol/session libraries. Setup configures the trusted issuer, dedicated client, exact redirect URL and one allowed owner. Provide revocable local sessions, no public signup and no local password database.

Bind verified stable issuer/subject to target/operator; never use username/email matching or untrusted claims. Do not share Django sessions/auth tables, handle InvenTree passwords, copy browser credentials or use database superuser access.

Keep tokens encrypted server-side behind restricted references. No tokens in URLs, browser storage, DTOs or job payloads.

The [official InvenTree API documentation](https://docs.inventree.org/en/stable/api/) describes a limited, experimental/opt-in OAuth2/OIDC identity-provider route and scoped API access. Register a dedicated client with only required feature scopes; the broad built-in public client is not a production shortcut.

Before deployment, qualify:

- Installed-version protocol support and claims/stable subject.
- Identity-to-API-user binding and refresh/revocation.
- Scope coverage and reliable effective-permission introspection.

A roles response alone does not prove endpoint capabilities. If the route cannot establish them, block access/deployment and revise the integration explicitly. No guessed permissions or service-account fallback.

### Access checks

On **every initial load**, before workspace data/actions, use read-only introspection to check the versioned server-owned manifest of all required effective user permissions and delegated token/client scopes. Cover the entire supported feature set; request no unrelated admin/delete rights.

- Missing rights: block with a safe missing-capabilities page.
- Missing/expired identity: require sign-in.
- Unavailable/incomplete checks: return retryable `access_unverified`, never access or a false permission denial.

The [data-model access contract](../typescript-data-model/01-identity.md#mandatory-access-qualification) owns the exact gate. Owner allowlisting does not replace it. No partially privileged workspace or privileged service-account bypass.

Every endpoint enforces current session/owner/object authority. Recheck permissions/scopes at approval, background dispatch/resumption and each privileged target request. Queued work retains its originating actor.

InvenTree enforces actual request authorization; prechecks cannot eliminate remote revocation races. Rejection blocks further work, not a credential upgrade. Expiry/revocation/lost introspection pauses new effects and retains approvals, source guards and in-flight uncertainty. Later login never authorizes automatic replay.

Qualify how background delegated access survives supported refresh/expiry. Do not assume an interactive login token works forever.

### Sessions and streams

Use revocable PostgreSQL-backed sessions with HttpOnly/Secure/SameSite cookies, idle/absolute expiry and rotation at login. No long-lived cookie cache may defeat revocation.

Apply access checks to SSE and evidence downloads. Active streams recheck session/access within a documented bounded interval and terminate on lost authorization.

Local sign-out revokes the local session. Provider logout and delegated-token revocation are separate supported operations with tested semantics.

Rate-limit login/bootstrap and record safe security events. Through maintained libraries, validate protocol state, issuer/audience/client, redirect and nonce/PKCE where applicable. Reject replay and identity substitution.

### Origin and CSRF

Allow one configured origin and disable broad CORS. Deliberately configure session/CSRF protection for login and every state-changing route; test actual middleware behavior.

Enforce trusted proxy/host/origin and safe methods/content types, with Fetch Metadata as additional defense. SameSite cookies alone are insufficient. Use supported protocol redirects, not cross-origin credential-sharing requests. The verified server session supplies the approval actor, never the browser body.

## Secret and process boundaries

| Component           | Required access                                                                                                 | Denied by design                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Browser             | Session cookie; public DTOs; authorized evidence                                                                | DB/target/provider secrets, raw prompts/runtime                                         |
| API/auth broker     | Product/session data, protocol tokens under restricted access, blob staging, redacted settings                  | Arbitrary inventory mutation dispatch; native provider credential store                 |
| Research runner     | Own supported native auth, scoped job files, approved read broker                                               | Apply secret/socket, whole blob volume, database administration                         |
| Read broker         | Restricted acting-user inventory-read/network-fetch capability                                                  | Mutation dispatch, raw credential disclosure or caller-selected internal hosts          |
| Apply               | Exact approved artifacts, journal/source-guard writes, fixed target and current acting-user delegated authority | Native provider auth, arbitrary web/source tools, self-approval or privilege escalation |
| Operator/migrations | Explicit maintenance privileges                                                                                 | Unattended evidence/provider execution as a side effect of migration                    |

Separate runtime database roles where feasible:

- API domain commands create approvals/run reservations.
- Workers cannot grant approval.
- Apply checkpoints the PostgreSQL journal but cannot rewrite approved scope.
- Projection writers access only expected tables.

Restrict database credentials to Bench Intake, independent of InvenTree's role. Inject secrets through OS/deployment facilities, not Vite variables or job payloads.

At-rest delegated secrets need an operator-managed encryption/root-secret and backup/rotation procedure. Database encryption without key separation is insufficient. The auth broker may manage tokens, but must not expose generic target writes to research.

## Threats and concrete controls

| Threat                                                    | Control and verification                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious PDF/image or decompression bomb                 | Byte/page/pixel/time/memory limits, content inspection, isolated maintained decoders, no document scripting; malformed corpus tests                                                                                                         |
| HTML/SVG/script source execution                          | Sanitize retained extracts; serve originals as authorized downloads or on an isolated origin with restrictive CSP; no inline untrusted HTML                                                                                                 |
| SSRF and DNS rebinding                                    | Fetch broker rejects private/link-local/metadata destinations for public research, validates resolved addresses and each redirect, pins connection destination, caps bytes/time; configured target is a separate explicit allowlisted route |
| Source/prompt injection                                   | Treat source content as evidence, enforce tool permissions outside prompts, no write secrets/tools in research; adversarial tests                                                                                                           |
| Path traversal/symlink/race                               | Opaque IDs and owned staging directories, verified containment/no-follow semantics, bounded ownership; never trust provider file paths                                                                                                      |
| Cross-batch evidence access                               | Object-level authorization on every ID/reference; hash secrecy is not access control                                                                                                                                                        |
| Duplicate/forged/stale messages                           | Authenticated runner + exact command/attempt/revision/version binding + duplicate conflict checks                                                                                                                                           |
| Remote target replacement                                 | Conservative continuity evidence and review gate; endpoint/PK equality is insufficient                                                                                                                                                      |
| HTTP client hidden write retry                            | Disable mutation retry/redirects and test actual sends against pre-send intents                                                                                                                                                             |
| Database/ownership connection outage or surviving process | Stop new authorization/sends, retain source guards and host exclusion; reap before replacement, preserve unknown effects                                                                                                                    |
| Evidence export leaks                                     | Explicit export selection, secret scrubbing, relative artifact refs, no executable raw credential/runtime dump                                                                                                                              |

A “read-only tool” is defined by semantic allowlist, not simply HTTP GET. A barcode lookup POST may be a read; an arbitrary endpoint supplied by a model is not allowed. Deny automatic target redirects and verify base endpoint on every apply request. Research web fetches cannot use target cookies or operator browser sessions.

## Observability and health

Use structured redacted logs with batch/job/attempt/command/approval/run/operation/request IDs. Connect API request IDs to logs and record actions/evidence, not private reasoning. Private source contents/filenames must not become broad metric labels.

Start with local logs and operator diagnostics. Export standard metrics/traces when useful; no mandatory Grafana/telemetry deployment is needed.

Monitor:

- Outbox lag/conflicts, workflow versions/queue occupancy and waiting questions.
- Runner capability/login, apply child liveness, last committed request and unknown effects.
- Projection lag, blob verification, storage capacity and last successful backup/restore test.

Liveness means responding; readiness also checks database/schema/restore gate/storage. Probes must not log in to a provider, infer or mutate inventory. Worker startup is explicit—never from web imports/autoreload/migrations.

Timeouts and limits are per boundary: upload bytes, decoded pixels/pages, retained source size, tool calls/time, research concurrency, HTTP connect/read/overall duration, SSE buffers and cancellation settlement. Select initial limits from representative test inputs and expose failures usefully. Do not claim numerical performance targets or unlimited files before measuring.

## Backup and restore is an execution safety boundary

Back up Bench Intake's PostgreSQL database, scheduler state, private blobs and configuration coherently. Protect secrets/keys separately. InvenTree keeps its own backup/continuity requirements despite the shared instance.

Restoring either independently may invalidate target identity/effects. A shared timestamp or host does not guarantee continuity. Even a coherent old backup can predate a remote create and have **no record** of it; absence after restore never permits execution.

All restore/clone procedures start read-only with new apply disabled. Enforce that gate outside the restored database, not solely through a restored flag.

```diagram
stop new apply → settle/reap old process → consistent backup manifest
                                             │
              app PostgreSQL product/journal/workflows + blobs + configuration
                                             │
restore into isolated environment → apply disabled outside restored DB
                                             │
verify hashes / compare retained authority / assess missing remote effects
                                             │
          reviewed continuity + reconciliation OR remain recovery-required
```

### Backup contents and procedure

Record application/target identity, database snapshot boundary, blob manifest, executor/contract versions and configuration identities. Back up secret keys separately with access controls.

1. Quiesce new approvals/dispatch and settle or reap apply and other publishers.
2. Use supported PostgreSQL backup methods, including library-owned scheduler state.
3. Copy immutable blobs incrementally if useful, ensuring every referenced hash exists.

Do not copy/migrate Python's SQLite journals through this procedure. Online coordinated backup needs its own proof.

### Restore activation and missing history

An operator-controlled external deployment marker/root secret binds database epoch and supported state location. Restore tooling never copies an “apply enabled” marker into a new environment. Apply requires explicit activation for the reconciled epoch.

The marker cannot protect against invisible whole-machine rollback by an administrator or arbitrary external writers; document these as unsupported.

If backup lost reliable attribution for possible later writes, keep source/target persistently blocked until stronger evidence or separately designed reconciliation exists. Do not invent force-clear procedures.

Test restoring a backup older than a fake remote stock create: the restored app must block replay despite the missing local run. A successful database restore alone is not a successful application recovery test.

## Deployments and migrations

Pin API/worker/runner/executor versions and record them on immutable commands/plans.

Deploy additive SQL first, then compatible workers; drain old-version work. Keep old questions immutable. Answers may schedule compatible continuations through an explicit, tested transformation.

Do not arbitrarily migrate active plans or reinterpret approved effects. Quarantine unsupported versions visibly rather than dropping them.

Separate scheduler cleanup from product retention: never delete approvals, canonical journal or evidence through scheduler retention.

Run migrations through an explicit Bench Intake operator/release step with a separate deployment/migration role. Never migrate on every web startup or through InvenTree migrations. Back up first and prove rollback/forward compatibility; downgrades cannot run newer plans they do not understand.

Supply a dependency bill of materials, locked installs and clean-host tests before claiming reproducible deployment.

## Transition from Python and other writers

Use isolated fake data during development and restrict initial TypeScript proof to new owned fake targets/sources. Preserve Python CLI namespaces/journals and local data unchanged.

TypeScript does not automatically import/share Python ownership or enforce cross-engine exclusion. Same-source live coexistence is unsupported.

Before a separately authorized transition, assess original target/source history and uncertain effects, quiesce old writers and verify the supported handoff. A new engine namespace or target alias cannot bypass missing history.

New host/source guards cover only the new supported TypeScript scope, not arbitrary external clients, old binaries or other hosts/accounts. If a transition cannot establish safe authority/history, remain blocked. No live cutover, active history/data relocation, raw journal editing, claim clearing or inventory mutation is authorized by publishing this design.

# 6. Security and operations

[Design index](README.md) · Proposed operational controls and release gates.

## Deployment baseline

Start on **the persistent InvenTree host**, with HTTPS access from phone/desktop. Run built React assets and the TypeScript API behind one reverse proxy, workers explicitly supervised and private durable media on local storage. Create a separate Bench Intake database and restricted database role in the existing PostgreSQL instance; separate migrations/credentials/backups and do not query InvenTree tables. Sharing an instance shares resource contention, outage and maintenance risk; set bounded pools/resource budgets without altering InvenTree infrastructure as part of this design. Package app/worker processes reproducibly; keep the personal native provider runner under its supported own-computer route. If the host/OS cannot support that native route, leave research unavailable rather than copying credentials or assuming container/remote deployment is permitted.

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

Use InvenTree as the identity authority through a qualified supported protocol integration, then maintain revocable local Bench Intake sessions with maintained protocol/session libraries. Initial setup configures the trusted issuer, dedicated client, exact redirect URL and one allowed owner; no public signup or local password database. Bind a verified stable issuer/subject to the configured target and operator, not a username/email match or an untrusted claim. Do not share Django sessions/auth tables, handle InvenTree passwords, copy browser credentials or use database superuser access. Tokens remain encrypted server-side behind restricted references; no token in URLs, browser storage, DTOs or job payloads.

The [official InvenTree API documentation](https://docs.inventree.org/en/stable/api/) describes a very limited, experimental/opt-in OAuth2/OIDC identity-provider route and scoped API access. Register a dedicated client and request only the supported feature set's required scopes; do not use the broad built-in public client as a production shortcut. Installed-version protocol support, claims/stable subject, identity-to-API-user binding, refresh/revocation, scope coverage and reliable effective-permission introspection must be qualified before deployment. Do not treat a roles response alone as proof of every endpoint capability. If the route cannot establish these, block access/deployment and revise the integration explicitly; no guessed permission or service-account fallback.

On **every initial load**, before workspace data/actions, check a versioned server-owned manifest of all required effective user permissions and delegated token/client scopes for the entire supported feature set, using read-only introspection. Request no unrelated admin/delete rights. Missing rights produce a blocking safe missing-capabilities page; expired/missing identity requires sign-in; unavailable/incomplete checks produce distinct retryable `access_unverified`, not access or a false permission denial. The [data-model access contract](../typescript-data-model/01-identity.md#mandatory-access-qualification) owns the exact gate. An owner allowlist does not replace it. No partially privileged workspace and no privileged service account bypass are supported.

Every endpoint enforces current session/owner/object authority. Recheck effective user permissions and delegated scopes at approval, background dispatch/resumption and each privileged target request; preserve the originating actor throughout queued work. A check cannot eliminate a remote revocation race: InvenTree enforces actual request authorization and a rejection blocks further work, not a credential upgrade. Expiry/revocation/lost introspection pauses new effects and retains approvals, source guards and in-flight uncertainty; a successful later login never authorizes automatic replay. The implementation must qualify how background delegated access survives supported refresh/expiry, not assume an interactive login token works forever.

Sessions are revocable PostgreSQL-backed records with HttpOnly/Secure/SameSite cookies, explicit idle/absolute expiry, rotation at login and no long-lived cookie cache defeating revocation. Require the same access checks on SSE and evidence downloads. Active streams recheck session/access within a documented bounded interval and terminate when no longer authorized. Local sign-out revokes the local session; provider logout and delegated-token revocation are separate supported operations whose semantics must be tested. Rate-limit login/bootstrap and record safe security events. Validate protocol state, issuer/audience/client, redirect, nonce/PKCE as applicable through maintained libraries; reject replay and identity substitution.

Allow one configured origin; disable broad CORS. Configure TypeScript API session and CSRF protection deliberately, including login and every state-changing route; test actual middleware behavior. Enforce trusted proxy/host/origin and safe methods/content types, with Fetch Metadata as additional defense. SameSite cookies are not the whole CSRF strategy. Use supported protocol redirects rather than cross-origin credential-sharing requests. Approval actor comes from the verified server session, not the browser body.

## Secret and process boundaries

| Component | Required access | Denied by design |
| --- | --- | --- |
| Browser | Session cookie; public DTOs; authorized evidence | DB/target/provider secrets, raw prompts/runtime |
| API/auth broker | Product/session data, protocol tokens under restricted access, blob staging, redacted settings | Arbitrary inventory mutation dispatch; native provider credential store |
| Research runner | Own supported native auth, scoped job files, approved read broker | Apply secret/socket, whole blob volume, database administration |
| Read broker | Restricted acting-user inventory-read/network-fetch capability | Mutation dispatch, raw credential disclosure or caller-selected internal hosts |
| Apply | Exact approved artifacts, journal/source-guard writes, fixed target and current acting-user delegated authority | Native provider auth, arbitrary web/source tools, self-approval or privilege escalation |
| Operator/migrations | Explicit maintenance privileges | Unattended evidence/provider execution as a side effect of migration |

Separate runtime database roles where feasible: API domain commands create approvals/run reservations; workers cannot grant approval; the apply role checkpoints the PostgreSQL journal but cannot rewrite approved scope. Limit projection writers to their expected tables. Keep database credentials restricted to the Bench Intake database, independent of InvenTree's role. OS/deployment facilities inject secrets, not Vite variables or job payloads. At-rest delegated secrets need an operator-managed encryption/root-secret and backup/rotation procedure; database encryption without key separation is not sufficient. The auth broker may manage tokens but must not expose a generic target-write endpoint to research.

## Threats and concrete controls

| Threat | Control and verification |
| --- | --- |
| Malicious PDF/image or decompression bomb | Byte/page/pixel/time/memory limits, content inspection, isolated maintained decoders, no document scripting; malformed corpus tests |
| HTML/SVG/script source execution | Sanitize retained extracts; serve originals as authorized downloads or on an isolated origin with restrictive CSP; no inline untrusted HTML |
| SSRF and DNS rebinding | Fetch broker rejects private/link-local/metadata destinations for public research, validates resolved addresses and each redirect, pins connection destination, caps bytes/time; configured target is a separate explicit allowlisted route |
| Source/prompt injection | Treat source content as evidence, enforce tool permissions outside prompts, no write secrets/tools in research; adversarial tests |
| Path traversal/symlink/race | Opaque IDs and owned staging directories, verified containment/no-follow semantics, bounded ownership; never trust provider file paths |
| Cross-batch evidence access | Object-level authorization on every ID/reference; hash secrecy is not access control |
| Duplicate/forged/stale messages | Authenticated runner + exact command/attempt/revision/version binding + duplicate conflict checks |
| Remote target replacement | Conservative continuity evidence and review gate; endpoint/PK equality is insufficient |
| HTTP client hidden write retry | Disable mutation retry/redirects and test actual sends against pre-send intents |
| Database/ownership connection outage or surviving process | Stop new authorization/sends, retain source guards and host exclusion; reap before replacement, preserve unknown effects |
| Evidence export leaks | Explicit export selection, secret scrubbing, relative artifact refs, no executable raw credential/runtime dump |

A “read-only tool” is defined by semantic allowlist, not simply HTTP GET. A barcode lookup POST may be a read; an arbitrary endpoint supplied by a model is not allowed. Deny automatic target redirects and verify base endpoint on every apply request. Research web fetches cannot use target cookies or operator browser sessions.

## Observability and health

Use structured redacted logs with batch/job/attempt/command/approval/run/operation/request IDs. Record actions and evidence, not private reasoning. API request IDs connect to logs; raw source contents and filenames may be private and should not be broad metric labels. No need for a mandatory Grafana/telemetry deployment: structured local logs plus operator diagnostics first, export standard metrics/traces when useful.

Monitor durable outbox lag/conflicts, workflow versions/queue occupancy, waiting questions, runner capability/login state, apply child liveness, last committed request, unknown effects, projection lag, blob verification failures, storage capacity and last successful backup/restore test. Liveness means process responding; readiness also checks database/schema/restore gate/storage. A probe must not log in to a provider, infer or mutate inventory. Worker startup is explicit; web imports/autoreload/migrations never launch lanes.

Timeouts and limits are per boundary: upload bytes, decoded pixels/pages, retained source size, tool calls/time, research concurrency, HTTP connect/read/overall duration, SSE buffers and cancellation settlement. Select initial limits from representative test inputs and expose failures usefully. Do not claim numerical performance targets or unlimited files before measuring.

## Backup and restore is an execution safety boundary

The Bench Intake PostgreSQL database, scheduler state, private blobs and configuration must be backed up coherently, with secrets/keys protected separately. InvenTree has its own backup/continuity requirements even though the databases share an instance. Restoring either independently may invalidate previously known target identity/effects; never assume a shared timestamp or host guarantees continuity. Even a coherent old backup can predate a remote create and have **no record** of it. Absence after restore is not permission to execute. All restore/clone procedures start read-only with new apply disabled, and that gate must not rely solely on a flag inside a restored database.

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

Backup records application/target identity, database snapshot boundary, blob manifest, executor/contract versions and configuration identities; secret keys are backed up separately with access controls. Quiesce new approvals/dispatch, settle or reap apply and other publishers, then use supported PostgreSQL backup methods including library-owned scheduler state. Immutable blobs can be copied incrementally, but all referenced hashes must exist. Python's SQLite journals are neither copied into this database nor migrated by this procedure. Online coordinated backup needs its own proof.

An operator-controlled external deployment marker/root secret binds database epoch and supported state location. Restore tooling never copies an “apply enabled” marker into a new environment. Apply requires explicit activation for the reconciled epoch. A marker cannot protect against an administrator restoring an entire old machine invisibly or arbitrary external writers; those are unsupported and documented. Where a backup has lost reliable attribution for possible later writes, the valid outcome is a persistent blocked source/target until stronger evidence or separately designed reconciliation exists. Do not invent a force-clear procedure.

Test restoring a backup older than a fake remote stock create: the restored app must block replay despite the missing local run. A successful database restore alone is not a successful application recovery test.

## Deployments and migrations

Pin API/worker/runner/executor versions and record the version on each immutable command/plan. Deploy additive SQL changes first; start compatible workers and drain old-version work. Leave old questions as immutable records; answers schedule a compatible continuation under an explicit transformation only where tested. No arbitrary migration of active plans or reinterpretation of approved effects. Unsupported versions are quarantined visibly, not dropped.

Scheduler retention must not delete approvals, canonical PostgreSQL journal or evidence; separate runtime history cleanup from product retention. Database migrations run through an explicit Bench Intake operator/release step, never every web startup or through InvenTree migrations. Use a deployment/migration role separate from ordinary runtime roles. Back up first and prove rollback/forward compatibility. A downgrade cannot run a newer plan it does not understand. Supply a dependency bill of materials, locked installs and clean-host tests before claiming reproducible deployment.

## Transition from Python and other writers

Use isolated fake data during development. Preserve all existing Python CLI namespaces/journals and local data unchanged. The new TypeScript application does not automatically share/import Python ownership or enforce cross-engine exclusion; same-source live coexistence is unsupported. Before a separately authorized transition, assess retained original target/source history and uncertain effects, quiesce old writers and verify the supported handoff. Restrict initial TypeScript proof to new owned fake targets/sources. A new engine namespace or target alias is not a bypass for missing history.

New host/source guards cover only the new supported TypeScript scope, not arbitrary external clients, old binaries or other hosts/accounts. If a transition cannot establish safe authority/history, remain blocked. No live cutover, active history/data relocation, raw journal editing, claim clearing or inventory mutation is authorized by publishing this design.

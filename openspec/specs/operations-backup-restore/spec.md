# operations-backup-restore Specification

## Purpose

Keep the intake application's database version, readiness and maintenance operations safe for execution history: refuse incompatible schemas, migrate only through an explicit step, archive a coherent database and blob cut only while apply is externally disabled, and restore only into fresh quarantined destinations that can never replay or erase later remote effects.

## Requirements

### Requirement: Operations schema compatibility quarantine

Schema compatibility SHALL mean the database's `public.schema_migration` rows exactly match the shipped migration file names and SHA-256 digests, in order. The web entry point MUST refuse to start with `database_version_quarantined` before registering application routes when they differ, and MUST NOT migrate, rewrite or reinterpret the schema itself.

#### Scenario: Changed or unknown migration set

- **GIVEN** a database whose migration digests differ from the shipped files, including when a temporary table shadows `schema_migration`
- **WHEN** the web process starts
- **THEN** it exits with a `web_startup_refused` record carrying `database_version_quarantined`, without the API key or database URL, and sends no target request.

### Requirement: Operations explicit migration step

Migrations SHALL run only through the explicit migrate command with a trusted migration role, inside one transaction under an advisory lock, applying unapplied files in name order and recording each digest. An applied migration whose file digest has changed MUST fail with `migration_drift`. Web startup, workers and autoreload MUST NOT run migrations or grant provisioning.

#### Scenario: Edited applied migration

- **GIVEN** a database where a migration was applied and its file was later edited
- **WHEN** the migrate command runs
- **THEN** it fails with `migration_drift` and applies nothing.

### Requirement: Operations liveness and readiness

`GET /api/v1/health` SHALL report liveness only, and `GET /api/v1/readiness` SHALL return 200 only when the development key is configured, the target context is current and the schema is compatible, otherwise 503 `readiness_unavailable`. Readiness MUST NOT send inventory requests or publish database errors or connection settings.

#### Scenario: Ready local development

- **GIVEN** a configured key, current target context and exact migrations
- **WHEN** readiness is requested
- **THEN** it returns 200 with `deployment: restricted-local-development`, `identity: deferred_T11`, `research: unqualified`, `updates: websocket-with-polling-fallback`, `apply: separately-supervised-owned-fake-only` and media `configured` or `disabled`, and no key or database URL.

#### Scenario: Drifted schema or rotated context

- **GIVEN** a changed migration digest or a target whose current context differs from configuration
- **WHEN** readiness is requested
- **THEN** it returns 503 `readiness_unavailable` with recovery `wait`.

### Requirement: Operations explicit maintenance configuration

Backup and restore SHALL run only through the explicit `operations backup` or `operations restore` command with injected database, scheduler, gate-root and archive settings, refusing defaults or discovery. Both database URLs MUST name the same local `intake_*` database, and native tools MUST receive credentials only through a scrubbed private environment.

#### Scenario: Separate scheduler database

- **GIVEN** an application URL and a scheduler URL naming different databases
- **WHEN** backup runs
- **THEN** it fails with `coherent_scheduler_database_required`.

#### Scenario: Connected to the wrong database

- **GIVEN** a pool whose current database differs from the configured name
- **WHEN** backup or restore runs
- **THEN** it fails with `operational_database_mismatch`.

#### Scenario: Maintenance failure output

- **GIVEN** any refused or failed maintenance run
- **WHEN** the command exits
- **THEN** it prints only an `operations_refused` record with a fixed recovery hint, and native-tool stderr is bounded and redacted.

#### Scenario: Missing or non-local configuration

- **GIVEN** a missing `INTAKE_OP_DATABASE_URL`, `INTAKE_OP_SCHEDULER_DATABASE_URL`, `INTAKE_OP_GATE_ROOT` or `INTAKE_OP_ARCHIVE`, or a URL that is not loopback, lacks credentials, has a query or names a database outside `intake_*`
- **WHEN** the command runs
- **THEN** it refuses before touching any database or archive.

### Requirement: Operations externally disabled apply for maintenance

Backup and restore SHALL require a valid private external activation file that disables apply, no physical writer claim and a well-formed witness directory, with the activation binding unchanged throughout. The tools MUST NOT change activation, claims or witnesses.

#### Scenario: Apply still enabled

- **GIVEN** an activation file that is not explicitly disabled
- **WHEN** backup runs
- **THEN** it fails with `externally_disabled_apply_required` before creating an archive.

#### Scenario: Writer not reaped

- **GIVEN** a retained physical writer claim
- **WHEN** backup or restore runs
- **THEN** it fails with `physical_writer_not_reaped`.

#### Scenario: Activation changes mid-operation

- **GIVEN** a backup or restore in progress
- **WHEN** any of the activation's deployment, epoch, target, context, origin, continuity, build or capability fields changes
- **THEN** the operation fails with `external_activation_changed`.

### Requirement: Operations coherent archive

Backup SHALL capture one consistent cut of the application and scheduler database and every retained blob, and write a canonical `bench-intake-archive/1` manifest that binds them. Archive files SHALL be created exclusively in a new private directory, so an existing archive is never overwritten.

#### Scenario: Successful backup

- **GIVEN** apply externally disabled and one retained blob
- **WHEN** backup runs
- **THEN** the archive contains `database.dump`, `blobs/<digest>` and `manifest.json`, and activation is still disabled.

#### Scenario: Existing destination

- **GIVEN** an archive path that already exists
- **WHEN** backup runs again
- **THEN** it fails without changing the existing archive.

#### Scenario: Archive limits

- **GIVEN** more than 10,000 blobs, more than 8 GiB of blob bytes, a dump over 8 GiB, a manifest over 2 MiB or a native tool running over 120 seconds
- **WHEN** backup or restore runs
- **THEN** it fails and leaves any incomplete destination for inspection.

#### Scenario: Consistent cut

- **GIVEN** apply externally disabled
- **WHEN** backup runs
- **THEN** it share-locks every table in one repeatable-read transaction, verifies schema compatibility, size-checks and copies every blob, dumps the exported snapshot, and records the dump digest, external binding digest, media store ID, blob and migration digests with `credentials: excluded` and `activation: externally-disabled`.

### Requirement: Operations quarantined restore

Restore SHALL accept only a fresh empty `intake_restore_*` database and a new private blob root, verify every archive digest and the external binding before restoring, and return `restored-quarantined` without enabling apply.

#### Scenario: Successful restore

- **GIVEN** a valid archive and a fresh empty destination
- **WHEN** restore runs
- **THEN** it returns `restored-quarantined`, the restored schema is compatible, the original blob bytes are retained and activation remains disabled.

#### Scenario: Corrupt or mismatched archive

- **GIVEN** a corrupt dump or blob, an archive from an incompatible migration set, or an external binding with a different epoch
- **WHEN** restore runs
- **THEN** it fails with `database_archive_corrupt`, `archive_blob_corrupt`, `archive_version_quarantined` or `archive_external_binding_mismatch`, and the destination database has no tables.

#### Scenario: Non-fresh destination

- **GIVEN** a destination not named `intake_restore_*`, a nonempty database, an existing blob root or a symlinked parent
- **WHEN** restore runs
- **THEN** it is refused and the original archive is unchanged.

### Requirement: Operations restore never replays later effects

A restored archive SHALL remain bound to the external witnesses preserved outside it, so an archive taken before a remote create cannot authorize that create again, even if apply is later enabled for the old deployment.

#### Scenario: Older archive after a later stock create

- **GIVEN** an archive taken before a supervised run created stock on the owned fake
- **WHEN** it is restored, apply is started while still disabled, and then apply is reactivated for that deployment
- **THEN** the first start fails with `apply_disabled`, the external gate then refuses with `restore_history_missing`, the attempted run stops as interrupted, and the fake still records only the original stock POST.

### Requirement: Operations web drain

On SIGTERM or SIGINT the web process SHALL log `web_draining`, terminate its live-update sockets, close its database pool and exit normally. Startup, drain and refusal records SHALL be structured fixed event codes that never contain raw errors, SQL, paths, keys or connection strings.

#### Scenario: Shutdown with an open socket

- **GIVEN** a running web process with an open live-update socket
- **WHEN** it receives SIGTERM
- **THEN** the socket closes and the process exits with code 0.

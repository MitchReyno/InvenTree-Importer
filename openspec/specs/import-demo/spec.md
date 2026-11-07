# import-demo Specification

## Purpose

`invimport demo` lets an operator watch the real `import-run` CLI and pinned InvenTree SDK prepare, execute, fail partly and recover against a persistent synthetic HTTP stub on loopback. It needs no real credentials, and the stub keeps every production approval, continuity, journal and claim rule. It is client-contract evidence only, not a live server or exactly-once guarantee.

## Requirements

### Requirement: Import demo owned workspace

`demo serve --workspace DIR --scenario happy|partial` SHALL create a private synthetic workspace only in a new, non-symlink directory with an existing parent. No demo command SHALL delete, reset or reseed a workspace.

#### Scenario: Existing directory

- **GIVEN** a path that already exists or is a symlink
- **WHEN** `demo serve --workspace` creates a new demo there
- **THEN** it refuses and changes nothing

#### Scenario: Missing workspace member

- **GIVEN** a workspace whose fake database or another owned member was deleted
- **WHEN** any demo command loads it
- **THEN** it fails and does not recreate the lost state

#### Scenario: New workspace contents

- **GIVEN** a new directory path and `--scenario partial`
- **WHEN** the server starts
- **THEN** the workspace holds `invimport-demo.json`, `server.sqlite3`, `source/`, `config/`, `demo.env`, `home/`, `output/` and `state/`, with directories 0700 and seeded files 0600 where supported

#### Scenario: Seeded scenario

- **GIVEN** either scenario
- **WHEN** the workspace is seeded
- **THEN** it holds one shared Part, two lots of 10 and 20 units, one supplier SKU, one purchase order with two priced contributions and one synthetic label

#### Scenario: No scenario

- **GIVEN** a new workspace path without `--scenario`
- **WHEN** `demo serve` runs
- **THEN** it refuses, and a failed initial startup leaves its partial directory for inspection

### Requirement: Import demo loopback server

The demo server SHALL bind only `127.0.0.1` and keep its fake records, barcode ownership, attachment bytes, consumed fault and request receipts across restarts. `--restart` SHALL reuse the original port, nonce and scenario, and Ctrl-C SHALL stop the listener while keeping all state.

#### Scenario: Damaged fake schema

- **GIVEN** a workspace whose fake database is missing a required column
- **WHEN** the server restarts
- **THEN** it refuses before binding or answering the identity probe, and does not reseed

#### Scenario: Restart changes the scenario

- **GIVEN** an existing partial workspace
- **WHEN** it is restarted with `--scenario happy`
- **THEN** the restart is refused

#### Scenario: Port occupied

- **GIVEN** a restart whose persisted port is in use
- **WHEN** the server starts
- **THEN** it fails rather than choosing another port

### Requirement: Import demo request pacing

`--delay-ms` SHALL accept only integers from 0 to 1000, defaulting to 0, and SHALL delay each `/api/` and `/media/` request before any effect or fault is applied. Pacing SHALL be a runtime setting that is not stored in the workspace.

#### Scenario: Invalid delay

- **GIVEN** `--delay-ms 1001` with a new workspace path
- **WHEN** `demo serve` runs
- **THEN** it fails with a usage error and no workspace is created

#### Scenario: Slower restart

- **GIVEN** a stopped workspace
- **WHEN** it restarts with `--delay-ms 250`
- **THEN** only request pacing changes; port, nonce, records, consumed fault and run history are preserved

#### Scenario: Identity probe

- **GIVEN** a server with a 250 ms delay
- **WHEN** the runner checks its identity
- **THEN** the identity probe answers without delay

### Requirement: Import demo partial scenario fault

The partial scenario SHALL seed one persisted fault: the first attachment POST receives HTTP 403 before anything is applied, and the fault is then consumed. The fake SHALL NOT reset the fault, simulate other failures or retry the rejected write.

#### Scenario: Partial run

- **GIVEN** a partial workspace with a prepared plan
- **WHEN** the operator runs `demo run DIR execute --write`
- **THEN** both lots are registered, one label evidence operation fails, and the command exits 1

#### Scenario: Explicit line controls

- **GIVEN** the prepared demo plan, which sends `merge_items=false` and `auto_pricing=false`
- **WHEN** both contributions are created
- **THEN** the fake keeps two separate lines with their own quantities and prices

#### Scenario: Fake record behavior

- **GIVEN** the demo fake
- **WHEN** the import creates stock and uploads evidence
- **THEN** stock creation returns a list, barcode ownership is exclusive and attachments are verified by persisted bytes over local media URLs

#### Scenario: Local inspection

- **GIVEN** a stopped server
- **WHEN** the operator runs `demo inspect DIR`
- **THEN** it reports the fake records, PKs, byte receipts, faults and requests from local state

### Requirement: Import demo isolated child CLI

`demo run DIR ACTION` SHALL run the real `import-run` CLI as `python -P -m invimport` in a fresh process pinned to the running package. Its environment SHALL contain only interpreter and OS settings plus the loopback target, a fake token, the demo environment file, an isolated home and an absolute private `INVIMPORT_STATE_DIR`.

#### Scenario: Real environment file present

- **GIVEN** a real `.env` with inventory credentials in the working directory
- **WHEN** a demo action runs
- **THEN** the child never sees those credentials and talks only to the loopback stub

#### Scenario: Shadowing paths

- **GIVEN** an inherited `PYTHONPATH` or working directory that contains another `invimport` package
- **WHEN** a demo action runs
- **THEN** the child still uses the running package

#### Scenario: Visible boundary

- **GIVEN** any demo action
- **WHEN** it runs
- **THEN** stderr shows the underlying command and paths, stdout carries the one real CLI result, and the latest result and event export are saved under `output/`

### Requirement: Import demo server identity check

Before prepare and any write action, the runner SHALL fetch the server's identity without proxies or redirects and require it to match the workspace nonce, stopping before any import request otherwise. Preview and status SHALL NOT require the server.

#### Scenario: Wrong server on the port

- **GIVEN** another demo server answering on the workspace port with a different nonce
- **WHEN** `demo run DIR execute --write` runs
- **THEN** it refuses before any import request

#### Scenario: Identity redirect

- **GIVEN** an identity probe that answers with a redirect
- **WHEN** the runner checks identity
- **THEN** it refuses without following the redirect

### Requirement: Import demo single execution and recovery

A workspace SHALL permit one write execution, and later status, resume and retry SHALL use its canonical registry and journal. `--write` and `--continuity-reason` SHALL be passed only when the operator supplies them.

#### Scenario: Recovery after a server restart

- **GIVEN** a partial run, a stopped server and local status showing the failed label
- **WHEN** the server restarts and the operator retries that operation with a continuity reason
- **THEN** the label is uploaded once, earlier inventory PKs are unchanged and status exits 0

#### Scenario: Second execution

- **GIVEN** a workspace that has already executed with `--write`
- **WHEN** `execute --write` is run again
- **THEN** it is refused and the operator is directed to status, resume, retry-operation or a new workspace

#### Scenario: Arguments checked

- **GIVEN** `demo run DIR status --write`, or `retry-operation` without an operation ID
- **WHEN** the command runs
- **THEN** it is refused before invoking the child

#### Scenario: Completed resume

- **GIVEN** a fully recovered demo run
- **WHEN** the operator resumes it
- **THEN** no remote records or transfers are added

### Requirement: Import demo interruption and timeout

On POSIX, Ctrl-C during `demo run` SHALL forward one interrupt to the separately grouped child, reap it and exit 130, and a child exceeding five minutes SHALL be stopped and reaped with exit 1. A missing `output/run.json` SHALL then be rebuilt read-only from validated canonical state.

#### Scenario: Interrupt after stock was created

- **GIVEN** a write execution interrupted after a stock item was created
- **WHEN** the operator later runs status and recovery
- **THEN** the locator is rebuilt from canonical state, known effects stay known and nothing is replayed

#### Scenario: Damaged authority

- **GIVEN** an interrupted run whose registry or journal is corrupt, missing or ambiguous
- **WHEN** the locator would be rebuilt
- **THEN** it fails closed and creates no claim, result or authority

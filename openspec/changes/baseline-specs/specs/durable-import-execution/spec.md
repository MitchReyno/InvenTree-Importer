# Capability delta

## Purpose

The opt-in durable stock import prepares a frozen, reviewed plan and executes it serially under canonical local ownership with a SQLite journal. It resumes, retries and disposes of runs without blind replay, while the legacy `import-stock` command keeps its default behavior. The `invimport import-run` CLI and the `execution` library expose it.

## ADDED Requirements

### Requirement: Durable import is opt-in beside the legacy default

The ordinary `import-stock` command SHALL keep its legacy workflow, flags, offline `--validate`, `--schema` and `--vocabulary`, and montage `--plan` schema. The durable workflow SHALL run only through `import-run` or the explicit library entry points (`prepare_full_stock`, `execute_stock`, `resume_stock`, `repair_stock`), and a durable failure MUST NOT fall back to legacy execution.

#### Scenario: Legacy command unchanged

- **GIVEN** a valid stock file
- **WHEN** the operator runs `import-stock` with or without `--write` or `--plan`
- **THEN** the legacy importer runs with its existing flags and report schema, and no durable plan or journal is created

#### Scenario: Offline validation

- **GIVEN** no reachable server and no state directory
- **WHEN** the operator runs `import-stock --validate`, `--schema` or `--vocabulary`
- **THEN** the command completes without a connection or journal

#### Scenario: Legacy unresolved location

- **GIVEN** a legacy import whose explicitly requested location cannot be resolved
- **WHEN** the legacy import writes
- **THEN** it still creates the stock without a location, as before the durable workflow existed

#### Scenario: Durable failure

- **GIVEN** a durable execution that stops with failed or uncertain work
- **WHEN** the command returns
- **THEN** the run stays in its journal and no legacy import of the same lines is attempted

### Requirement: Durable import preparation freezes a reviewed plan

`import-run prepare FILE --output PLAN.json` SHALL make only read-only discovery requests and save an immutable schema-2 plan holding the approved choices, effective inputs, configuration digest, target and source bytes. It MUST NOT prompt, mutate inventory or persist category YAML, and SHALL reject unresolved choices and unsupported work before any write.

#### Scenario: Read-only preparation

- **GIVEN** a valid stock file and a reachable target
- **WHEN** the operator runs `import-run prepare`
- **THEN** the outline appears on stderr before the connection, only read requests are sent, and one JSON preview with `prepared: true` is written to stdout

#### Scenario: Ambiguous choice

- **GIVEN** an input whose category or part match is ambiguous
- **WHEN** preparation runs without a terminal
- **THEN** it returns one JSON error naming the choice to correct, without prompting

#### Scenario: Two new purchase orders

- **GIVEN** lines that need two distinct new purchase orders
- **WHEN** preparation runs
- **THEN** it stops with a review message before any write, because the advertised reference is not a reservation

#### Scenario: Unresolved explicit location

- **GIVEN** a line with an explicitly requested location that cannot be resolved and location creation disabled
- **WHEN** preparation runs
- **THEN** it rejects the line for review instead of planning unlocated stock

### Requirement: Durable import plan loading and target binding

Plan loading SHALL accept plan schemas 1 and 2 and reject anything else that is unknown, malformed or contradictory. Execution SHALL use the plan's frozen bytes and choices and SHALL refuse a target that differs from the plan's.

#### Scenario: Source deleted after preparation

- **GIVEN** an approved plan whose source files were deleted
- **WHEN** the operator executes it with `--write`
- **THEN** execution uploads the frozen source bytes from the plan and does not read the deleted paths

#### Scenario: Target drift

- **GIVEN** an approved plan for one endpoint and a configured `INVENTREE_URL` for another
- **WHEN** execute, resume or retry runs
- **THEN** it stops before connecting and reports the mismatch

#### Scenario: Unknown plan schema

- **GIVEN** a plan file with an unsupported schema version or an unknown nested field
- **WHEN** it is loaded
- **THEN** loading fails and nothing is executed

#### Scenario: Malformed dependencies

- **GIVEN** a plan with duplicate JSON keys, a dependency cycle, a missing output reference or contradictory shared inputs
- **WHEN** it is loaded
- **THEN** loading fails before any run is created

### Requirement: Durable import write authorization

`execute`, `resume`, `retry-operation` and `abandon` SHALL do remote or disposition work only with `--write`, and otherwise show the frozen preview without connecting. `--yes` MUST NOT imply `--write`, resolve ambiguity or certify database continuity.

#### Scenario: Preview without write

- **GIVEN** an approved plan
- **WHEN** the operator runs `import-run execute PLAN.json --json`
- **THEN** stdout holds an `invimport-run-preview/1` result with `preview_only: true` and no request reaches the server

#### Scenario: Write flag on status

- **GIVEN** `import-run status RUN_ID --write` or `prepare ... --write`
- **WHEN** the arguments are parsed
- **THEN** it is a usage error with exit 2

### Requirement: Durable import canonical state root

The importer SHALL resolve one canonical state root under `inventree-importer`, from an absolute `INVIMPORT_STATE_DIR` or else the platform user-state location. State directories SHALL be private (0700) and journals, retained artifacts and generated plans 0600 where supported.

#### Scenario: Relative override

- **GIVEN** `INVIMPORT_STATE_DIR` set to a relative path
- **WHEN** any durable command or legacy write starts
- **THEN** it fails instead of resolving authority against the working directory

#### Scenario: Platform default

- **GIVEN** no `INVIMPORT_STATE_DIR`
- **WHEN** the state root is resolved
- **THEN** it is under Application Support on macOS, `XDG_STATE_HOME` or `~/.local/state` on Linux, or `LOCALAPPDATA` on Windows

### Requirement: Durable import canonical claims

The canonical registry SHALL reserve a claim keyed by target and import identity before the journal is created, and activate it before any dispatch. An unresolved claim SHALL survive process exit and block every new durable or supported legacy write for that import, and missing or corrupt authority SHALL fail closed.

#### Scenario: Unresolved claim from an earlier run

- **GIVEN** an earlier durable run with uncertain work for an import
- **WHEN** a fresh process executes a new plan for the same import, in any run directory
- **THEN** execution is refused before dispatch because the claim requires reconciliation

#### Scenario: Legacy writer with a durable claim

- **GIVEN** an unresolved durable claim for an import
- **WHEN** the legacy `import_stock` library or CLI writes the same import
- **THEN** it is refused before stock discovery or mutation

#### Scenario: Registry deleted

- **GIVEN** a state root whose permanent initialization marker remains but whose registry file was deleted
- **WHEN** any run, status or legacy write starts
- **THEN** it fails closed for operator recovery instead of creating an empty registry

#### Scenario: Reviewed alias

- **GIVEN** an unresolved claim under one endpoint
- **WHEN** an alias endpoint is registered with review evidence and a write is attempted through it
- **THEN** the alias shares the same namespace and the write is still refused

#### Scenario: Completed run and later revision

- **GIVEN** a completed run with no unresolved work
- **WHEN** a new revision for the same import executes
- **THEN** it runs in a new journal and the earlier run stays discoverable

#### Scenario: Binding inspection

- **GIVEN** an approval bound to a run directory whose claim is reserved but whose journal is missing
- **WHEN** `execution.adoption.inspect_binding` is called
- **THEN** it returns `recovery_required` with no snapshot, and a different unresolved claim, changed revision or unregistered occupied directory fails closed

#### Scenario: Unsupported registry schema

- **GIVEN** a registry or journal with an unknown schema version or a failed integrity check
- **WHEN** any command opens it
- **THEN** it fails closed without migrating

### Requirement: Durable import journal records intent before dispatch

Each run's single-writer SQLite journal SHALL commit attempt and request intent before every child send, and commit output identities, effect certainty, attribution and state together on settlement. A failed commit, replaced journal or lost ownership SHALL stop every later child dispatch.

#### Scenario: Every send has one intent

- **GIVEN** a durable stock execution through the pinned SDK
- **WHEN** the run completes
- **THEN** every actual HTTP send has exactly one durable request intent recorded before it

#### Scenario: Crash after a write was sent

- **GIVEN** a process that stopped after sending a create but before settling it
- **WHEN** a fresh process resumes the run
- **THEN** the operation is `uncertain` with an unknown effect and the create is not sent again

#### Scenario: Journal failure after a read

- **GIVEN** a journal that becomes unwritable after a successful read
- **WHEN** the operation's next child would be a mutation
- **THEN** the mutation is not dispatched and the run reports the local journal failure

#### Scenario: Journal failure after a remote create

- **GIVEN** a create that the server applied but whose checkpoint commit fails
- **WHEN** the run stops
- **THEN** no later mutation is sent and the effect is reported as potentially unrecorded rather than replayed

#### Scenario: Interrupted read

- **GIVEN** a process that stopped during a read-only attempt
- **WHEN** the run resumes
- **THEN** the read settles as `retry_wait` and may be requeued

### Requirement: Durable import create responses and unknown effects

A create SHALL be confirmed only from one object, or a one-element list, with a positive integer PK and the expected identity, checkpointed before any dependent request. A lost, malformed or uncorrelated create MUST NOT be replayed or matched by payload, and its unknown effect MUST NOT become successful.

#### Scenario: Lost stock create

- **GIVEN** a stock create that was applied but whose response was lost
- **WHEN** the run is resumed or the operation retried in a fresh process
- **THEN** the operation stays uncertain, no second stock item is created, and identical-looking lots are not merged

#### Scenario: Multiple objects returned

- **GIVEN** a create response containing two objects, or an empty list, or an invalid PK
- **WHEN** the handler validates it
- **THEN** every trustworthy PK is retained as an effect, the operation needs review and the create is not repeated

#### Scenario: Row-only promotion

- **GIVEN** a journal whose operation row was edited to `succeeded` while its result holds an unknown effect
- **WHEN** completion is evaluated
- **THEN** the run is not complete and the unknown effect is retained

#### Scenario: Explicit rejection

- **GIVEN** an identity-parameter create the server rejected with a 4xx status, leaving the Part checkpointed and its stock blocked
- **WHEN** the operator selects that parameter operation for retry
- **THEN** the revalidated create is sent again under the same operation ID, the Part is not duplicated and the blocked stock then registers

### Requirement: Durable import dependency scheduling

The executor SHALL run one operation at a time in plan order, starting each only when its named required outputs exist and its `settled_after` operations have settled. Operations missing required outputs SHALL become `blocked` while independent branches continue.

#### Scenario: part_of after a failed parent line

- **GIVEN** a parent line whose Part was created but whose stock or photo failed
- **WHEN** a later `part_of` line runs
- **THEN** it consumes the parent's Part output and proceeds

#### Scenario: Missing identity parameter

- **GIVEN** a spec Part whose required identity parameter failed
- **WHEN** scheduling continues
- **THEN** the stock that needs that Part is blocked while unrelated lines and finalization proceed

#### Scenario: Repaired output reactivates descendants

- **GIVEN** a blocked child whose parent output is restored by explicit reconciliation
- **WHEN** execution continues
- **THEN** the child becomes eligible again

#### Scenario: Finalization after failures

- **GIVEN** inventory branches that failed, became uncertain, need review or are irrecoverably blocked
- **WHEN** they have all settled
- **THEN** finalization runs without treating them as successful

### Requirement: Durable import cooperative cancellation

The executor SHALL check cancellation, journal health, owner thread and ownership immediately before every child dispatch, including after reads and inside reconciliation. Cancellation SHALL stop new requests without undoing confirmed work, and an in-flight request SHALL settle as confirmed or unknown.

#### Scenario: Cancel during a read

- **GIVEN** an operation that reads a record and then would PATCH it
- **WHEN** cancellation is requested during the read
- **THEN** the PATCH is never dispatched and the run identity stays available for local status

#### Scenario: Cancel with failed event export

- **GIVEN** a write execution with `--events` whose destination cannot be written
- **WHEN** the operator presses Ctrl-C
- **THEN** the command exits 130 and the result reports `events_saved: false`

### Requirement: Durable import local status

`import-run status RUN_ID` SHALL report the run from the canonical registry and journal without connecting, after validating the journal's history, and fail closed on corruption. It SHALL exit 0 only when the run is complete and local retention is intact.

#### Scenario: Status with the server stopped

- **GIVEN** a run with failed evidence work and the server offline
- **WHEN** the operator runs `status RUN_ID --json`
- **THEN** status is returned from local state with no request and exits 1

#### Scenario: Corrupted journal

- **GIVEN** a journal whose succeeded operation lost its result
- **WHEN** status, resume or the store opens it
- **THEN** it fails closed before any remote call

#### Scenario: Legitimate intermediate rows

- **GIVEN** a running operation that holds a checkpoint, or a blocked operation that keeps an earlier retry-wait result
- **WHEN** status validates the journal
- **THEN** both rows are accepted as valid

#### Scenario: Retained artifact damaged

- **GIVEN** a completed run whose retained artifact bytes were removed
- **WHEN** status runs
- **THEN** it reports incomplete retention without reopening inventory work or contacting the server

#### Scenario: Status contents

- **GIVEN** a run executed in a custom `--run-directory`
- **WHEN** `status RUN_ID --json` runs
- **THEN** it returns `invimport-run-status/1` with operations, attempts, requests, retention, registry disposition and the durable journal sequence

### Requirement: Durable import continuity acknowledgement

`resume` and `retry-operation` SHALL require a nonempty `--continuity-reason`, checked before connecting and recorded in the registry audit as the operator's reviewed same-database acknowledgement. The acknowledgement MUST NOT override known endpoint, instance, record identity, company role or purchase-order metadata drift, and SDK server details SHALL NOT be treated as immutable identity.

#### Scenario: Missing continuity reason

- **GIVEN** a run with saved outputs
- **WHEN** the operator runs `resume RUN_ID --write` without `--continuity-reason`
- **THEN** the command stops before connecting

#### Scenario: Reason with known drift

- **GIVEN** a verified target instance that differs from the plan's
- **WHEN** resume runs with a continuity reason
- **THEN** it is still refused

### Requirement: Durable import resume and selected retry

Resume SHALL classify interrupted attempts and run pending work while keeping failed, review and unknown results. `retry-operation` SHALL add an attempt under the original operation ID and recover only prerequisites needed for usable outputs, never resetting unknown effects or retrying inventory that only settled for finalization.

#### Scenario: Selected evidence retry

- **GIVEN** a run where one lot's stock failed and an attachment failed
- **WHEN** the operator retries the attachment operation
- **THEN** only the attachment and its eligible dependants run, the failed stock is not retried, and Part, stock and order PKs are unchanged

#### Scenario: Missing prerequisite

- **GIVEN** a failed operation whose required input output is missing
- **WHEN** the operator retries it
- **THEN** the prerequisite is recovered first under its own original ID

#### Scenario: Completed run resumed

- **GIVEN** a completed run
- **WHEN** it is resumed
- **THEN** committed status is returned and no mutation is sent

#### Scenario: Repair revalidates first

- **GIVEN** a known stock record selected for tag, link or barcode repair
- **WHEN** the repair attempt runs
- **THEN** it reads and validates the saved record before any conditional write

### Requirement: Durable import abandonment

`abandon RUN_ID --reason TEXT --write` SHALL record the reason and a blocking tombstone, keeping the claim, every known and unknown effect and a completed run's history. Abandonment SHALL NOT certify absence of effects, release ownership or enable another import, and there SHALL be no force or unlock command.

#### Scenario: Abandon leaves the import blocked

- **GIVEN** an abandoned run with unknown effects
- **WHEN** a new execution for the same import starts
- **THEN** it is refused because the tombstone still blocks the claim

#### Scenario: Abandon a completed run

- **GIVEN** a completed run
- **WHEN** abandonment is requested
- **THEN** the run stays complete and its history is retained

### Requirement: Durable import completion and exit codes

The CLI SHALL exit 0 when selected applicable work is satisfied or a preview was produced, 1 for incomplete, failed, uncertain, review, blocked or persistence failure, 2 for usage errors and 130 for cancellation. With `--json` it SHALL write one JSON result to stdout and progress to flushed stderr.

#### Scenario: Optional evidence failed

- **GIVEN** a run whose lots registered but whose selected attachment failed
- **WHEN** execution finishes
- **THEN** it exits 1, and after the failed upload is retried successfully the same run exits 0 with the stock count unchanged

#### Scenario: Disabled scope

- **GIVEN** a line whose archive recipient is disabled or genuinely inapplicable
- **WHEN** finalization settles
- **THEN** the line is reported as explicitly unattached rather than failed, while an applicable route with no usable recipient needs review

#### Scenario: Programming error after a write

- **GIVEN** a handler that raises an unexpected error after a confirmed create
- **WHEN** the CLI handles it
- **THEN** no further work is dispatched, the run ID is reported, the output contains only the exception class and an embedding caller receives the original cause

### Requirement: Durable import generated output protection

Plan and event destinations SHALL be refused, with exit 1, when they resolve inside canonical state, a registered or marked run root, a new run directory, the configuration directory or the invocation's input and source files. The check SHALL run before work and before each write.

#### Scenario: Events path inside a run

- **GIVEN** an `--events` path that would replace a held run lock or retained artifact
- **WHEN** the command starts
- **THEN** it refuses with `unsafe_output_destination` before any work

#### Scenario: Unrelated file with the same name

- **GIVEN** an output path outside owned roots that shares a basename with a journal file
- **WHEN** the command runs
- **THEN** the destination is accepted

#### Scenario: Missing authority

- **GIVEN** a registry that no longer exists
- **WHEN** outputs are validated
- **THEN** enumeration is read-only and does not recreate it

### Requirement: Durable import stock field policies

Durable registration SHALL be complete only after barcode ownership of the intended stock is confirmed. Recovery SHALL add missing approved values but SHALL NOT overwrite manual values, restore historical stock fields or recreate deleted stock.

#### Scenario: Deleted known stock

- **GIVEN** a run whose created stock item was later deleted on the server
- **WHEN** the operator repairs its metadata
- **THEN** the operation needs review and no replacement stock is created

#### Scenario: Manual parameter value

- **GIVEN** an existing matched Part whose parameter holds a different nonempty value
- **WHEN** the durable import runs
- **THEN** the value is preserved and the difference needs review, while missing approved parameters are added as separate operations

#### Scenario: Tag repair after an external edit

- **GIVEN** owned new stock to which another client added a tag before repair
- **WHEN** the tag operation is repaired
- **THEN** the approved tags are present and the unrelated tag is kept, while quantity and batch edits are not reverted

#### Scenario: Divergent order link

- **GIVEN** a stock item whose purchase-order link was changed manually
- **WHEN** the link operation is repaired
- **THEN** it needs review and the link is not overwritten

### Requirement: Durable import locations and order lines

An explicitly requested location SHALL never become unlocated, and each original line SHALL get its own purchase-order contribution. Contributions SHALL be created only when target OPTIONS advertise writable `merge_items` and `auto_pricing`, both sent as `false`.

#### Scenario: Location creation disabled

- **GIVEN** an explicit missing location with `--no-locations`
- **WHEN** preparation runs
- **THEN** it requires review instead of planning unlocated stock, while a line with no location stays unlocated

#### Scenario: Identical lots

- **GIVEN** two lines with the same Part, supplier SKU and quantity
- **WHEN** the plan executes
- **THEN** two stock items and two purchase-order lines are created

#### Scenario: Old plan without line controls

- **GIVEN** a plan prepared before purchase-order line controls were frozen
- **WHEN** a new execution would create a contribution from it
- **THEN** execution is rejected before the POST and the plan must be prepared again

#### Scenario: Order metadata drift

- **GIVEN** a saved purchase order whose currency or metadata was changed after it was created
- **WHEN** a new contribution or stock link would consume it
- **THEN** the consumer is blocked for review and the order is not overwritten

### Requirement: Durable import evidence artifacts

Finalization SHALL run settled inventory, then `invimport-execution-provenance/1`, the immutable source archive, uploads and the `invimport-execution-report/1` report. Source bytes, manifest and targets SHALL be frozen before execution and receipted by relative name, size, SHA-256 and effect-set fingerprint.

#### Scenario: Pending upload after source deletion

- **GIVEN** a failed archive upload and a deleted source directory
- **WHEN** a fresh process repairs the upload
- **THEN** the retained bytes are verified and uploaded with no new inventory write

#### Scenario: Source changes during staging

- **GIVEN** a source file modified while it is being read for the archive
- **WHEN** staging runs
- **THEN** the affected artifact fails instead of silently changing identity

#### Scenario: No change

- **GIVEN** a run that made no inventory change
- **WHEN** finalization runs
- **THEN** no new archive is created

#### Scenario: Archive exclusions

- **GIVEN** a source folder that contains canonical state, a run journal with SQLite sidecars or a recognised generated plan
- **WHEN** the archive manifest is built
- **THEN** those files are excluded while legitimate vendor files are kept

### Requirement: Durable import artifact verification

Only verified remote bytes SHALL satisfy evidence, never a filename match, and retained bytes SHALL match their receipt before every transfer. A confirmed or uncertain transfer SHALL never be sent again.

#### Scenario: Confirmed upload missing from listing

- **GIVEN** a confirmed upload that no longer appears in the remote attachment listing
- **WHEN** repair runs
- **THEN** it only verifies and does not upload a replacement

#### Scenario: Retained bytes modified

- **GIVEN** a retained archive whose bytes no longer match the receipt SHA-256
- **WHEN** an upload is attempted
- **THEN** the upload is blocked

#### Scenario: Repaired inventory

- **GIVEN** a completed run whose inventory effect set changes through repair
- **WHEN** finalization runs again
- **THEN** a new artifact revision is appended and the earlier archive and its upload record are unchanged

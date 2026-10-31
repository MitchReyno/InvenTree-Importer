# Durable stock command (opt-in)

`import-run` releases the durable full stock workflow. The default `import-stock`
command and all existing flags, including its montage `--plan` schema, retain their
meaning. There is no fallback to legacy execution after a durable failure.

```sh
uv run invimport import-run prepare stock.json --output approved-plan.json --json
uv run invimport import-run execute approved-plan.json --json
uv run invimport import-run execute approved-plan.json --write --events events.jsonl --json
uv run invimport import-run status RUN_ID --json
uv run invimport import-run resume RUN_ID --write --continuity-reason 'Reviewed same database, unchanged restore/instance history' --json
uv run invimport import-run retry-operation RUN_ID OPERATION_ID --write --continuity-reason 'Reviewed same database and saved record continuity' --json
uv run invimport import-run abandon RUN_ID --reason 'Reviewed unresolved outcome; retain blocking claim' --write --json
```

Preparation validates configuration/input, connects and performs complete read-only
discovery, including authentication, pagination and selected media downloads. The
conditional outline appears before connection, and the resolved hierarchy appears
before inventory changes. Preparation saves an immutable schema-2 plan containing
approved choices, effective line inputs, configuration digest and source bytes.
Execution consumes that plan; it does not reload current source/configuration or
rediscover permissions because source files disappeared. Review the plan hierarchy
and protect the entire plan as sensitive inventory data. Editing a plan changes its
revision and requires new review; this is not a cryptographic authorization format.
A changed revision cannot replace an active run: resume/retry load its original plan
from the journal and new execute remains blocked by its unresolved canonical claim.

Preparation is deliberately noninteractive. Resolve ambiguous names/categories in
the input/configuration or use the library's preparation callbacks. `--on-partial
new` is an explicit choice; the default skips a partial match. Other options include
`--config`, `--location`, `--min-confidence`, `--mirror-datasheets`, `--no-orders`,
`--no-manufacturers`, `--no-suppliers`, `--no-locations`, `--no-archive` and
`--no-provenance`. There is no implicit category YAML persistence. Preparation may
create selected configured taxonomy/templates and location paths only as visible
future operations; it never mutates inventory. A single preview supports at most
one distinct newly allocated PO reference, because OPTIONS is not a reservation.
Differing archive sources with the same basename are conservatively refused.

`--write` authorizes execute/resume/retry and local abandon disposition. Without it,
these commands show the frozen preview and perform no connection or mutation.
`--yes` only accepts choices already explicitly supplied; it does not imply writes,
resolve ambiguity or certify database continuity. No prompt is required for this
explicit workflow. Preparation and status require no `--write`.

## Recovery and continuity

`status` uses the canonical local registry, even when execute used a custom
`--run-directory`. It does not authenticate or contact the server. Missing/corrupt
registry or journal fails closed. Status distinguishes operation outcomes and
current retained bytes; missing/corrupt completed artifacts make retention incomplete
without reopening completed inventory or recreating uploads.

Resume retains failed/review/unknown states; it is not permission to repeat a
failed write. Retry selects a domain operation and recursively recovers only
prerequisites needed for usable outputs. Settlement barriers are different: failed
inventory can settle for evidence finalization, and selecting evidence does not
retry every failed inventory branch. Saved outputs/effects, original operation IDs
and every prior attempt remain. An unknown uncorrelated create or PO contribution
cannot be correlated from matching payload alone. Investigate the remote system
and journal; never delete the registry to get past this protection.

URL equality and SDK `server_details` are not proof of immutable database identity.
The CLI requires `--continuity-reason` for resume/retry. This is an operator's reviewed
same database acknowledgement after checking restore/migration history and saved
record identity, retained in the registry audit. It never overrides known endpoint,
instance, identity, company role or PO metadata drift. A reason is separate from
`--yes` and `--write`. If continuity cannot be established, do not acknowledge it.
Use read-only investigation and retain the blocking claim.

Repair applies the original frozen intent. Correcting input/configuration/identity
is a different semantic revision, not a retry. There is no general active-plan
migration/rebase command in this release. Repreparing or editing PLAN.json does not
replace the journal's plan, clear the claim or reinterpret old outputs. Use supported
same-intent reconciliation where possible. If the original intent cannot safely be
satisfied, preserve the run and blocking disposition for operator investigation;
do not change source references/line IDs, delete claims or provide a continuity
reason to bypass it. A later reviewed revision facility must explicitly account
for prior identities/effects and authorization; this command does not implement one.
Completed history likewise does not authorize changing consumed stock quantities,
locations/batches or recreating deleted historical records.

Abandon records a reason and blocking tombstone, preserving all known and unknown
remote effects and claims. It does not certify absence of remote effects, release
ownership or enable another import. There is no force/unlock command. Resolve
uncertain effects through reviewed domain reconciliation; unresolved dispositions
need operator investigation rather than an automatic override. A completed run
stays complete when abandonment is requested; its history is retained.

Ctrl-C exits 130. Cancellation is cooperative at child dispatch boundaries; an
in-flight mutation can still complete. Confirmed responses/checkpoints remain
confirmed, lost outcomes remain unknown, and interrupted journals recover before
later dispatch. Unexpected programming failures stop the command with their cause
preserved for an embedding caller; public error output contains a safe exception
class, never raw SDK bodies/tokens. Locally composed preparation-review messages
identify the inventory choice needing correction; they never use raw SDK errors. No automatic rollback/delete is attempted.

## Output and future UI

Every action accepts `--json` and `--events FILE`. JSON stdout contains one result;
progress and diagnostics use flushed stderr and remain visible without a TTY.
Exit 0 means the selected applicable work is satisfied (or a valid preview was
produced), 1 means incomplete/failed/uncertain/review/blocked or persistence failure,
2 means argument usage error, and 130 means cancellation. Selected optional metadata
and evidence failures count as incomplete; disabled/inapplicable work does not.

`invimport-run-preview/1`, `invimport-run-status/1`, execution snapshot schema 1,
and `invimport-execution-report/1` are versioned projections. Status includes stable
operation IDs, attempt/request IDs and their outcomes. SQLite owns the truth.
The status `sequence` is the durable journal event sequence. `--events` is a separate
`invimport-observation/1` JSONL stream: each record has a `stream` invocation ID,
monotonically increasing invocation-local `sequence`, and durable correlation when
inside execution. A new invocation replaces the file; sequences must never be
joined without their stream IDs. Events are exported from the retained observation
snapshot at invocation completion, rebuilding any renderer delivery gaps. They
are not a crash-durable journal or a replay command. After loss, renderer failure
or process termination, rebuild from local status. There is no TUI dependency.

Events contain controlled labels, methods, outcomes, timing and safe correlation;
headers, credentials, payloads and free-form SDK errors are excluded. Status/plans
and provenance can contain sensitive inventory facts, filenames, PKs and operator
audit reasons. Do not put credentials in inventory fields or review reasons.

## Storage, inspection and retention

Discover the platform user-state directory at runtime (`execution.ownership.state_root`),
or deliberately set absolute `INVIMPORT_STATE_DIR`. macOS uses Application Support,
Linux uses `XDG_STATE_HOME` (otherwise `.local/state`), and Windows uses LOCALAPPDATA.
The canonical `execution/registry.sqlite3`, permanent initialization marker and locks
coordinate this local user scope. Run journals normally live below `execution/runs`;
custom directories remain registered canonically. Changing the state root, host,
user, using old binaries or raw API clients bypasses this local coordination and
is not an approved recovery technique. Keep writers on one local filesystem/user
scope; no network filesystem or cross-host lock guarantee is claimed.

State directories use mode 0700 and database, retained artifact and generated plan
files use mode 0600 where supported. Protect parent directories, backups and exported
JSON too. Keep credentials in environment/.env configuration, outside execution
state. Back up the registry, marker and whole stopped run directory together; SQLite
and its sidecars must be captured consistently. Do not copy active database files
and assume the result is safe. There is no automatic retention/deletion policy.
Keep unresolved journals/claims and all historical artifact revisions. Retain
completed runs according to your evidence policy; removing retained bytes makes
status honestly report local damage.

Use `status --json` for portable inspection/export of attempts, requests, results
and retention. Copy the prepared plan separately only when appropriate; it includes
source bytes. These projections are not automatic executable portable resume
credentials or proof of target continuity. Supported readers accept plan schema 1
and 2, run/registry SQLite schema 1; unsupported versions fail closed and there is
no automatic upgrade/downgrade migration. Keep the supported binary with backups.

On disk-full, SQLite commit failure or retained-artifact failure, stop new work,
preserve all state and free space outside the run. Retry status/read-only inspection
first. A crash after remote success but before local commit is uncertain, even if
the remote server looks plausible. Restore a verified consistent local backup only
with explicit reconciliation of everything attempted since that backup. Corruption,
missing journals or registry replacement require operator recovery; do not create
an empty replacement registry. A failed event export is reported and does not alter
confirmed effects. Reports/events are replaceable projections; journals and immutable
artifact receipts/bytes are the recovery authority.

## Rollout gates

The opt-in supports full stock library domain work and artifact finalization within
these restrictions. It does not claim complete interactive legacy parity: no
implicit category-YAML persistence, automatic multi-new-PO allocation or arbitrary
basename collision resolution. `import-stock --plan` remains the legacy report
projection; the durable command does not currently generate that montage. Library
`project_stock_result` remains available for report integrations. The default must
stay legacy until remaining parity/fault and operational gates are reviewed.
DigiKey adaptation, live-target allocator/identity guarantees and concurrency remain
Stage 7 work. Fake transports establish client contracts, not cross-client
exactly-once effects or live server atomicity.

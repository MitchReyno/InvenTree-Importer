# Run the import demo locally

The demo runs the real `invimport import-run` CLI and pinned InvenTree SDK against
an actual HTTP stub listening only on `127.0.0.1`. It needs no InvenTree or DigiKey
credentials, Docker or real server. All components, companies, prices, evidence
and credentials are synthetic. This demonstrates client behavior against this
stub; it establishes no live server capability or exactly-once guarantee.

From a checkout with `uv sync` already completed, start a server in one terminal:

```sh
uv run invimport demo serve --workspace demo-partial --scenario partial
```

`demo-partial` must be a **new directory** with an existing parent. Do not point it
at your inventory/configuration folder. The command prints its bound loopback URL,
instance nonce, workspace paths and next commands. Leave this terminal running.
Use `--scenario happy` and a different new directory for an entirely successful
run. Both scenarios contain one shared Part, two distinct lots (10 and 20 units),
one supplier SKU, one PO and two distinct priced PO contributions. A synthetic
label and generated provenance/archive exercise multipart uploads and media
byte verification.

The partial scenario consumes exactly one persisted fault: the first attachment
POST receives HTTP 403 **before any bytes/record are applied**. Later uploads and
independent inventory work continue. There is no automatic fault reset, generic
network-failure simulation or hidden retry of a rejected write.

In another terminal, from the same checkout:

```sh
uv run invimport demo run demo-partial prepare
uv run invimport demo run demo-partial execute
```

Preparation performs real read-only HTTP discovery/authentication/OPTIONS, displays
the resolved hierarchy and saves `demo-partial/output/plan.json`. Review that plan.
The second command previews it without connecting or writing. Authorize the frozen
demo import explicitly:

```sh
uv run invimport demo run demo-partial execute --write
uv run invimport demo run demo-partial status
uv run invimport demo inspect demo-partial > demo-partial/output/fake-before.json
```

Expect exit 1 from the partial execution/status: both lots are registered, while
one selected evidence operation failed. `happy` execution/status exits 0. Stderr
shows the real per-request start/finish and operation outcomes, including setup,
barcode lookup/link, CRUD, OPTIONS, attachment POSTs and media GETs. Stdout contains
one JSON result from the real CLI. The wrapper also saves each action's latest
result and invocation event export under `output/`; exports are replaceable views,
while the real SQLite registry/journal remains authoritative.

Find the failed original operation ID without hand-editing any plan or journal:

```sh
uv run python -c 'import json; from pathlib import Path; result=json.loads(Path("demo-partial/output/execute-result.json").read_text()); print("\n".join(row["id"] for row in result["operations"] if row["state"] == "failed"))'
```

Review `status` and `fake-before.json`, including the consumed `reject_before`
fault, known record PKs, two barcode owners and media SHA-256 receipts. There is
one failed label evidence operation. Use its printed ID as `OPERATION_ID` below:

```sh
uv run invimport demo run demo-partial retry-operation OPERATION_ID --write --continuity-reason 'Reviewed the unchanged synthetic demo database, original instance nonce and saved record PKs'
uv run invimport demo run demo-partial status
uv run invimport demo inspect demo-partial > demo-partial/output/fake-after.json
```

Retry uses the original run/operation IDs, retained plan, attempts and confirmed
outputs; it does not erase the failed attempt or canonical claim. Only selected
failed work and eligible dependent/finalization work recover. The source label is
uploaded once. A changed confirmed effect set can legitimately add new immutable
provenance/archive revisions; historical uploads remain. Part, stock, PO and PO-line
counts and PKs stay unchanged. Inspect those exact records with this comparison:

```sh
uv run python -c 'import json; from pathlib import Path; before=json.loads(Path("demo-partial/output/fake-before.json").read_text()); after=json.loads(Path("demo-partial/output/fake-after.json").read_text()); routes=("part/","stock/","order/po/","order/po-line/"); assert all(before["records"][r] == after["records"][r] for r in routes); print({r: [x["pk"] for x in after["records"][r]] for r in routes})'
uv run invimport demo run demo-partial resume --write --continuity-reason 'Reviewed the same completed synthetic database and retained records'
uv run invimport demo inspect demo-partial
```

Completed resume adds no remote records/transfers. A workspace permits one write
execution; further execute writes are refused before connection. Use resume/retry
for its history and a new workspace for another independent demonstration. Do not
delete its locator/registry/journal to force another execution.

## Stop, restart and inspect

Press **Ctrl-C in the server terminal**. It closes the listener and retains every
fake record, consumed fault, byte receipt and real recovery journal. Local
`demo run ... status` and `demo inspect ...` still work while the server is stopped.
To demonstrate recovery across a server restart, stop it after the partial run,
inspect status locally, and restart it before the retry:

```sh
uv run invimport demo serve --workspace demo-partial --restart
```

Restart binds the original persisted port and database/nonce. If the port is
occupied, it fails; stop the occupying process using your normal tools or wait
for the port to become available. It never chooses a different target for an
existing history. Never edit the port or copy a different database over this one.
A missing/corrupt fake database or missing workspace member is an error, rather
than permission to reseed. Failed initial startup can leave a partial directory;
retain it for inspection and choose a new directory for another initial launch.

There is no daemon, PID file, kill endpoint or automated recursive cleanup.
After stopping the server and any import process, you may delete **only the exact
demo directory you created**, using your file manager. Check its
`invimport-demo.json` marker and synthetic contents first. Keep it if you want to
inspect or resume the demonstration later. Existing directories/symlink workspace
roots are refused, and the command never removes unrelated files.

## Isolation and retained files

The runner launches `python -P -m invimport ... import-run` in a fresh process with
the running package location explicitly pinned. It ignores your actual `.env`,
real target/vendor credentials, proxy configuration, user home and state settings.
The child receives the loopback URL, obvious fake token, demo-only environment
file, source/configuration paths and absolute private `INVIMPORT_STATE_DIR`.
Before network work it verifies the stub's instance nonce without following
redirects or using proxies. Preview/status do not need a server health call.
`--write` and reviewed `--continuity-reason` remain separate requirements of the
real CLI; neither is silently supplied. The command prints its underlying CLI
invocation and paths so this boundary is visible.

| Workspace member | Purpose |
|---|---|
| `invimport-demo.json` | Owned workspace format/scenario/instance and stable port |
| `server.sqlite3` | Persistent fake records, barcode ownership, attachment bytes, consumed fault and HTTP receipts |
| `source/` | Synthetic stock input and label; archive scope stays here |
| `config/` | Self-contained demo category and parameter configuration |
| `demo.env`, `home/` | Demo-only environment file and isolated child home/cache |
| `output/plan.json` | Reviewed executable plan with frozen source bytes |
| `output/run.json` | Convenience locator for the original run, never execution authority |
| `output/*-result.json`, `output/*-events.jsonl` | Latest real CLI projections per action; replaced on the next same action |
| `state/execution/registry.sqlite3` | Real canonical local registry and retained claims |
| `state/execution/runs/` | Real journals, attempts/requests, artifacts and outcome reports |

The workspace directory is private (0700), and manifest, fake DB, source/config
and result files use 0600 where supported. Generated execution state retains the
normal protection rules. Do not put real credentials, stock or evidence into demo
files. The HTTP fake supports the small seeded stock scenario, not a general
InvenTree installation: no live vendor fetching, receiving/DigiKey demo, images,
redirects, arbitrary API compatibility, cross-client concurrency or lost-response
scenario is promised. PO lines realistically merge by default; the real prepared
workflow advertises/checks and sends `merge_items=false`, `auto_pricing=false`,
preserving the two source quantities/prices. Reference remains correlation, not a
unique constraint. Stock creation returns a list; barcode ownership is exclusive;
attachment confirmation verifies exact persisted bytes over local media URLs.

For production operator contracts and limitations, see [import-run](import-run.md).
Never substitute the demo target/state directory for a real run's recovery state.

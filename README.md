# InvenTree-Importer

A utility for getting component data out of DigiKey and into
[InvenTree](https://inventree.org/), without hand-typing part numbers, pack
quantities and datasheet links into forms.

## Overview

Populating an InvenTree instance from scratch means gathering the same handful
of facts for every part — the manufacturer part number, packaging, minimum
order quantity, a datasheet URL — and those facts already exist in DigiKey's
API. This tool fetches them, normalises them, and loads the parts of them that
InvenTree's CSV importer cannot handle on its own.

It provides five commands:

| Command         | What it does                                                                                                            |
|-----------------|-------------------------------------------------------------------------------------------------------------------------|
| `product`       | Look up DigiKey SKUs and report packaging, pack quantity, MOQ, description, datasheet and canonical product link        |
| `orders`        | Fetch order history or a single sales order, with line items, ordered/shipped quantities, pricing and shipment tracking |
| `import-orders` | Pick DigiKey orders from a checklist and book them into InvenTree as purchase orders                                    |
| `parameters`    | Create and update InvenTree parameter templates from `config/parameters.yaml`                                          |
| `categories`    | Create and update InvenTree part categories from `config/categories.yaml`, and learn DigiKey path aliases              |

Two design points worth knowing up front:

* **A DigiKey part number identifies a *variation*, not a product.** Cut tape,
  reel, tube and digi-reel are separate SKUs of the same part with different
  packaging and pack quantities. `product` resolves the SKU you asked for
  against `ProductVariations`, so the packaging reported is the one you would
  actually receive — not a property of the product in general.
* **Every command is also a library.** The CLI modules are thin adapters over
  importable functions that return data and print nothing, so you can compose
  new tooling from them. See [Using it as a library](#using-it-as-a-library).

## Getting started

### Requirements

* Python 3.12
* [uv](https://docs.astral.sh/uv/) for dependency management
* A DigiKey developer account with API access
* An InvenTree instance running API version 530 or later

### Install

```bash
git clone <this-repo>
cd InvenTree-Importer
uv sync
```

`uv sync` creates `.venv`, installs dependencies from `uv.lock`, and installs
the project itself so the `invimport` command is available. There is no venv to
activate — prefix commands with `uv run`.

### Credentials

Copy the example file, then fill in the missing values in `.env`:

```bash
cp .env.example .env
```

```ini
# DigiKey — https://developer.digikey.com/
DIGIKEY_CLIENT_ID=...
DIGIKEY_CLIENT_SECRET=...
DIGIKEY_ACCOUNT_ID=...        # required by the orders command only

# InvenTree
INVENTREE_URL=http://localhost
INVENTREE_TOKEN=...           # preferred
# or, if you have not generated a token:
INVENTREE_USER=...
INVENTREE_PASSWORD=...
```

Optional locale settings, which default to US:

```ini
DIGIKEY_LOCALE_SITE=US
DIGIKEY_LOCALE_CURRENCY=USD
DIGIKEY_LOCALE_LANGUAGE=en
```

`.env` is gitignored and should stay that way. Real environment variables take
precedence over the file, so you can override one for a single run:

```bash
DIGIKEY_LOCALE_CURRENCY=AUD uv run invimport product 296-1234-1-ND --pricing
```

### Two things that will bite you first

* **The DigiKey app needs a separate subscription per API product.** Access to
  Product Information does *not* grant OrderStatus. A `403` on your first
  `orders` run almost certainly means the missing subscription, not bad
  credentials.
* **`DIGIKEY_ACCOUNT_ID` is mandatory for orders.** Under two-legged OAuth
  there is no signed-in user, so DigiKey has to be told whose orders to return.
  It is on the "My Account" page of the developer portal.

### Check it works

```bash
uv run invimport --help
uv run pytest
```

## Usage

Run any command with `--help` for its full options.

### product

Look up one or more DigiKey SKUs.

```bash
uv run invimport product 296-1234-1-ND
uv run invimport product 296-1234-1-ND 311-1.00KHRCT-ND --pricing
uv run invimport product 296-1234-1-ND --json results.json

# read SKUs from stdin, one per line
printf '296-1234-1-ND\n311-1.00KHRCT-ND\n' | uv run invimport product -
```

| Flag              | Effect                                                  |
|-------------------|---------------------------------------------------------|
| `--pricing`       | Also report the unit price at the lowest break quantity |
| `--json PATH`     | Write results as JSON                                   |
| `--raw`           | Dump the raw API payload for each SKU                   |
| `--refresh`       | Ignore the cache and refetch                            |
| `--cache-dir DIR` | Override the cache location                             |
| `--sandbox`       | Use DigiKey's sandbox (returns fabricated data)         |

If a SKU matches no `ProductVariation`, it is reported with a warning and
`packaging`/`pack_quantity` left empty rather than guessed at.

### orders

Fetch order history, or one specific sales order.

```bash
uv run invimport orders                                    # last 30 days
uv run invimport orders --start-date 2026-01-01 --end-date 2026-06-30
uv run invimport orders --shared                           # whole account, not just you
uv run invimport orders --order 87654321                   # one sales order
uv run invimport orders --json orders.json --refresh
```

| Flag                          | Effect                                                          |
|-------------------------------|-----------------------------------------------------------------|
| `--start-date` / `--end-date` | `YYYY-MM-DD` window (defaults to the last 30 days)              |
| `--shared`                    | Include all orders on the account, not just your own            |
| `--order ID`                  | Fetch a single sales order; repeatable, skips the history sweep |
| `--refresh`                   | Ignore the cache and refetch                                    |

**Use `--refresh` when the answer has to be current.** Order data is live —
statuses, shipments and tracking numbers change after an order is placed, and a
cached history page will not show orders placed since it was written.

### import-orders

Fetch orders, choose which ones you want from a checklist, and book each one
into InvenTree as a purchase order.

```bash
uv run invimport import-orders                             # dry run, last 30 days
uv run invimport import-orders --start-date 2026-01-01 --write
uv run invimport import-orders --order 87654321 --write    # one sales order
uv run invimport import-orders --all --supplier 1 --write  # no prompts
```

It takes the same date and scope flags as `orders`, plus:

| Flag                  | Effect                                                              |
|-----------------------|----------------------------------------------------------------------|
| `--write`             | Apply changes. Without it you get a dry run                          |
| `--all`               | Import everything found, skipping the checklist                      |
| `--supplier NAME\|PK` | Use this supplier and skip the supplier prompt                       |
| `--partial`           | Import an order even when some lines have no matching supplier part  |
| `--no-products`       | Skip the product lookup for the selected orders                      |
| `--plain`             | Use the numbered checklist instead of the arrow-key one              |

The checklist starts with everything selected. Move with the arrow keys (or
`j`/`k`), toggle with `SPACE`, `a` for all, `n` for none, and `ENTER` to
submit. `q` or `ESC` cancels.

```
Orders found (3):
  > [x] 12345678      2026-07-01      41.50 AUD  1 line  [Shipped]
    [x] 12345679      2026-07-14      12.05 AUD  1 line  [Shipped]
    [ ] 12345680      2026-08-02       8.20 AUD  1 line  [Shipped]

  2 of 3 selected
  UP/DOWN move   SPACE toggle   a all   n none   ENTER import   q cancel
```

Long lists scroll to fit the terminal. If the terminal cannot support that —
piped output, a `dumb` terminal, Windows — it falls back automatically to a
numbered list where you type numbers or ranges (`1 3-5`) to toggle. `--plain`
forces that version, as does setting `INVIMPORT_PLAIN_PROMPT=1`.

**Product details are fetched once you submit.** Every SKU across the selected
orders is looked up against the Product Information API, which is what lets an
unmatched SKU be reported as a real part rather than a bare number:

```
  ! skipped DigiKey 12345680 / sales order 87654323: no line item matched a supplier part
      - NOT-STOCKED: no supplier part with this SKU
          NE555P  IC OSC SINGLE TIMER
```

Running it after the selection means only the orders you are actually
importing cost API calls. Results land in the same product cache `invimport
product` uses, so a second run over the same orders is free. `--no-products`
skips the step.

**The supplier.** Orders are booked against a company named `DigiKey` flagged
as a supplier. The usual spellings (`Digi-Key`, `DigiKey Electronics` and so
on) are recognised, so an instance set up by hand does not end up with a second
near-duplicate company. If there is no match you are offered the choice of
creating one or picking an existing supplier under a different name:

```
No supplier named 'DigiKey' in InvenTree.

DigiKey orders need a supplier to book against:
  1) create a new supplier named 'DigiKey'
  2) use existing: Digi-Key AU Pty (pk=7)
  3) use existing: Tayda (pk=2)
  q) cancel
```

**Parts have to exist already.** An InvenTree purchase order line points at a
`SupplierPart`, which in turn needs an internal `Part`, so a DigiKey line can
only be imported if its SKU is already stocked as a supplier part under the
chosen supplier. Nothing is invented: unmatched lines are reported by SKU, and
by default an order with any unmatched line is skipped whole rather than
creating a purchase order quietly missing half of what was bought. Use
`--partial` to import the lines that do match.

**Re-running is safe.** Each purchase order records its DigiKey sales order id
in `supplier_reference`, and an order already imported is recognised and left
alone. One purchase order is created per *sales* order, so a DigiKey order
split across two shipments produces two — that is where the line items live.

Orders arrive as `PENDING`. Issuing them and receiving stock are deliberately
left to you in InvenTree.

### parameters

Create and update the InvenTree parameter templates defined in
`config/parameters.yaml`. Templates are the vocabulary parts are described
with: a category names the parameters its parts carry, and each of those has to
exist as a template with the right units before any value can be stored.

```bash
# dry run: reports what it would do, changes nothing
uv run invimport parameters

# apply
uv run invimport parameters --write
```

**Dry run is the default.** Nothing is written without `--write`, and nothing is
ever deleted — a template on the server the config does not mention is reported
and left alone, since parts may be using it. Re-running is safe.

The config is a mapping of template name to its properties:

```yaml
Resistance:
  units: ohm                     # pint unit; InvenTree derives data_numeric
  description: Nominal resistance value
  aliases: [Resistance, Resistance (Ohms)]   # names suppliers use
  parse: quantity                # how to read a supplier value

Composition:
  choices: [Metal Film, Carbon Film, Thick Film]

Mounting:
  choices: [Through Hole, Surface Mount]
  values:                        # canonical value -> supplier spellings
    Through Hole: [Thru Hole, Axial, Radial]
```

`units` matters twice over. InvenTree computes `data_numeric` by parsing the
stored value against the template's unit, which is what makes a parameter
sortable and filterable — and it is what values are formatted into. Values are
stored unit-bearing and human-readable, using pint's compact short-pretty
format:

| Magnitude | Unit | Stored as |
|---|---|---|
| 100000 | `ohm` | `100 kΩ` |
| 0.25 | `W` | `250 mW` |
| 2.2e-7 | `F` | `220 nF` |
| -55 | `°C` | `-55 °C` |

That costs nothing in sortability, because InvenTree parses the string back.
Every formatted value is round-trip checked before it is stored — a unit whose
display symbol cannot be parsed back falls through to a plainer form rather
than being written wrongly.

**Custom units are created first.** A template names its unit, and InvenTree
rejects one it cannot resolve, so anything pint does not already know has to
exist before the template that uses it. Declare those in `config/units.yaml`:

```yaml
ppm_per_delta_degC:
  definition: ppm / delta_degC     # a pint expression, evaluated by InvenTree
  symbol: ppm/°C                   # display only, 10 characters maximum
```

The command does units then templates in one pass, so the ordering is not
something you have to remember. Common units — `ohm`, `V`, `W`, `F`, `°C`,
`%` — need no entry. A template declaring a unit the server cannot resolve is
reported by name rather than failing as a bare HTTP 400.

`aliases`, `parse` and `values` are not sent to InvenTree. They tell the part
import how to recognise a parameter in supplier data and how to read its value.

Parameter *values* are not set by this command. They come from supplier data as
parts are imported. `from_supplier()` in `invimport.inventree.values` is how
a DigiKey parameters dict becomes the stored strings — `100 kOhms` is
`100 kΩ`, `±1%` is `1 %`, `-55°C ~ 155°C` splits into two temperatures.
`-` means absent and is not written.

### categories

Create and update the InvenTree part category tree defined in
`config/categories.yaml`. Templates are ensured first, because a category
names the parameters its parts carry.

```bash
# dry run: reports what it would do, changes nothing on the server
uv run invimport categories

# apply
uv run invimport categories --write

# map unmapped DigiKey paths from the product cache (writes the YAML)
uv run invimport categories --learn
```

**Dry run is the default** for the server. Nothing is created or renamed
without `--write`, and nothing is deleted. `--learn` writes aliases back
into the YAML so the same DigiKey path is never asked about twice. The
menu starts at the top-level categories, marks which are structural and
how many subcategories they have, and drills down with the arrow keys
(or numbered choices over a pipe). Create is offered at the current
level; a slash in the name nests children. An unmapped path is never
guessed — a part in the wrong category is worse than a part not imported.

### Global flags

| Flag              | Effect                                              |
|-------------------|-----------------------------------------------------|
| `--env-file PATH` | Read credentials from somewhere other than `./.env` |
| `-v`, `--verbose` | Include debug-level log output                      |

## Using it as a library

Every command's logic is importable. The library returns data, logs rather than
prints, and raises rather than exiting — so it composes.

```python
from invimport import load_env, digikey_connect, fetch_orders, fetch_products, line_items

load_env()
client = digikey_connect(need_account=True)     # one token, reused across calls

orders = fetch_orders(client, start_date="2026-01-01")
skus = sorted({line["digikey_part"] for line in line_items(orders)})
products = fetch_products(skus, client)

for product in products:
    print(product["SKU"], product["datasheet"])
```

That example — "find every part I have ordered this year and collect its
datasheet" — is the motivating case for the split.

The order import is importable too. It takes its answers as arguments, so
nothing prompts and nothing prints; only the CLI does that.

```python
from invimport import fetch_orders, find_supplier, import_orders, inventree_connect

api = inventree_connect()
supplier = find_supplier(api)                   # None if there is not one yet

result = import_orders(fetch_orders(start_date="2026-01-01"), api,
                       supplier=supplier, write=True)
print(result.counts())
for order in result.orders:
    for line in order.unmatched:
        print(order.sales_order_id, line.sku, line.reason)
```

With `write=False` nothing is created and the same result describes what a
real run would do.

Log output is opt-in:

```python
import logging
logging.getLogger("invimport").addHandler(logging.StreamHandler())
```

The public surface is re-exported from `invimport`: `fetch_products`,
`fetch_product`, `fetch_orders`, `fetch_sales_orders`, `line_items`,
`import_orders`, `find_supplier`, `list_suppliers`, `create_supplier`,
`sync_templates`, `sync_categories`, `sync_tree`, `from_supplier`,
`match_path`, `match_name`, `load_config`, `digikey_connect`,
`inventree_connect`, `load_env`, `load_env_file`, `Client`, `SyncResult`,
`ImportResult`, `ConfigError`, `DigiKeyError`, `InvenTreeError`.

Note that `fetch_orders` and `fetch_products` write to the cache like the CLI
does, relative to the working directory. Pass `cache_dir=` if you need them
somewhere else.

## Caching

DigiKey responses are cached to disk so re-runs do not burn API quota:

```
.cache/.digikey/products/     productdetails payloads
.cache/.digikey/orders/       order history pages and sales orders
```

One JSON file per request, named so a cache directory can be skimmed by eye.
Order cache keys include the date window and `--shared` scope, so a different
query can never be served a stale page from another one.

To force a refetch, pass `--refresh` or delete the directory. The cache is
relative to the working directory, so **run commands from the repo root** or
you will scatter `.cache` directories.

## Project layout

```
config/
    units.yaml                custom units, created before any template needs them
    categories.yaml           part categories, their parameters and DigiKey aliases
    parameters.yaml           parameter templates and how to read supplier values
    manufacturers.yaml        learned manufacturer name mappings
src/
    invimport/
        __main__.py           CLI entrypoint and subcommand registry
        cache.py              on-disk response cache
        config.py             YAML config loading and validation
        env.py                .env loading
        digikey/
            api.py            auth, endpoints, HTTP retry, Client
            products.py       Product Information API
            orders.py         OrderStatus API
        inventree/
            api.py            connection and API 530 model overrides
            parameters.py     parameter templates, from config/parameters.yaml
            units.py          custom units, from config/units.yaml
            values.py         parse DigiKey values, format them for InvenTree
            matching.py       normalise, learned aliases, fuzzy candidates
            categories.py     part categories, from config/categories.yaml
            purchase_orders.py  suppliers and DigiKey order import
        commands/             thin CLI adapters over the above
            _keys.py          raw-mode key reading for the interactive prompts
            _prompt.py        checklist and menu prompts
tests/                        mirrors the package
    conftest.py               shared fixtures
    support.py                test doubles: fake DigiKey, stub InvenTree
    test_cache.py
    test_cli.py
    test_env.py
    test_library.py
    digikey/
        test_products.py
        test_orders.py
    inventree/
        test_parameters.py
docs/
    InvenTree API.yaml        OpenAPI spec, used by the test suite
```

This is the standard [src layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/):
the package is `invimport`, and `src/` is only a container. Keeping it out of
the repo root means the root is not on `sys.path`, so tests always exercise the
installed package rather than accidentally importing loose source.

Adding a command means dropping a module in `commands/` exposing `NAME`,
`HELP`, `add_arguments(parser)` and `run(args)`, then listing it in
`commands/__init__.py`.

## Development

```bash
uv run pytest                          # everything
uv run pytest tests/digikey            # one package's suite
uv run pytest -k cache                 # by name
```

`tests/` mirrors the package, so the tests for `invimport.digikey.orders` are in
`tests/digikey/test_orders.py`. Fixtures are in `tests/conftest.py`, and the
fakes they wrap are in `tests/support.py` — importable directly if you want a
`FakeDigiKey` or an `InvenTreeStub` outside of a fixture. Nothing test-related
ships in the built wheel.

No test touches the network or your real
cache: DigiKey requests are faked, and anything that writes a cache runs in a
temporary directory.

The InvenTree suite runs against a stub server that serves **only** routes
present in `docs/InvenTree API.yaml` and 404s everything else, so a call to a
route that no longer exists fails loudly rather than silently passing against a
permissive mock.

The interactive prompts are tested the same way as everything else. The
`answers` fixture scripts what a user would type and forces the numbered
checklist, so the supplier menu and the selection flow run end to end without a
tty. The arrow-key version is split into a state machine (`Checklist`), a
renderer (`frame`) and a loop with injected I/O (`run_cursor`), all of which
are driven directly by keypress; the terminal handling underneath is exercised
against a real `pty`, including that raw mode is always restored.

### Notes for maintainers

* **`inventree` is pinned to `>=0.13.5,<0.14` deliberately.** InvenTree API 530
  moved parameters to `/api/parameter/` and replaced the `part` field with
  `model_type` + `model_id`, but the client library still ships the pre-530
  routes. `src/invimport/inventree/api.py` overrides them. If a later release fixes
  this upstream, the override becomes the bug — hence the ceiling.
* **`.env` interpolation is disabled.** python-dotenv expands `${VAR}` by
  default, and there is no way to escape it — every quoting style expands, and
  an unset name collapses to empty. In a file full of secrets that is silent
  corruption, surfacing later as a puzzling `401`.
* **The project is intentionally not distributable as a wheel.** `.env` is
  located relative to the package and the cache relative to the working
  directory; both assume a repo checkout. Installing it elsewhere would need
  that path resolution reworked first.

## Licence and third-party materials

This project is licensed under the GNU General Public License v3.0 — see
`LICENSE`. Third-party materials are listed in `THIRD-PARTY-NOTICES.md`.

### Using the DigiKey API

You need your own DigiKey developer account and API credentials. Access is
granted under the
[DigiKey API User Agreement](https://developer.digikey.com/api-user-agreement),
which you accept when registering, and rights under it cannot be transferred
(§20) — so credentials are never shared or bundled with this tool. That is why
`.env` is yours to fill in and is gitignored.

Three obligations the agreement places on you, which this project is built to
respect:

* **Attribute DigiKey as the source of its data** (§3.1.4, §5.1(c)). Where you
  publish or display anything retrieved through this tool, say where it came
  from. The `source` column in the parameter values CSV exists partly for this.
* **Do not redistribute DigiKey data or documentation** (§3.2(iii), §3.2(iv),
  §4). The API specifications and the response cache are gitignored for this
  reason; see `docs/digikey-api/README.md`.
* **Do not imply endorsement or affiliation** (§5.1(f)).

Worth reading §5.1(e) — which restricts using the API to create or update your
own database of information — against §1(iii), which permits an internal
application automating your own purchasing. Whether a given deployment sits
inside the permitted purpose is a question for DigiKey (api.contact@digikey.com),
not for this README.

### Trademarks

DigiKey is a trademark of Digi-Key Corporation. InvenTree is a trademark of its
respective owners. This project is an independent tool and is **not affiliated
with, endorsed by, or sponsored by** either.

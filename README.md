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

It provides three commands:

| Command      | What it does                                                                                                            |
|--------------|-------------------------------------------------------------------------------------------------------------------------|
| `product`    | Look up DigiKey SKUs and report packaging, pack quantity, MOQ, description, datasheet and canonical product link        |
| `orders`     | Fetch order history or a single sales order, with line items, ordered/shipped quantities, pricing and shipment tracking |
| `parameters` | Create InvenTree parameter templates and attach parameter values to parts                                               |

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

Copy the example file and fill it in:

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

Optional locale settings, which default to Australia:

```ini
DIGIKEY_LOCALE_SITE=AU
DIGIKEY_LOCALE_CURRENCY=AUD
DIGIKEY_LOCALE_LANGUAGE=en
```

`.env` is gitignored and should stay that way. Real environment variables take
precedence over the file, so you can override one for a single run:

```bash
DIGIKEY_LOCALE_CURRENCY=USD uv run invimport product 296-1234-1-ND --pricing
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

### parameters

Load part parameters into InvenTree. Parameters cannot ride along in the Part
import CSV — InvenTree's importer handles one model per file — so they are
loaded separately through the API.

```bash
# dry run: reports what it would do, changes nothing
uv run invimport parameters --templates templates.csv --values values.csv

# apply
uv run invimport parameters --templates templates.csv --values values.csv --write
```

**Dry run is the default.** Nothing is written without `--write`, and nothing
is ever deleted. Both stages are idempotent, so re-running is safe.

Input formats:

```csv
# templates.csv
name,units,description,choices,checkbox
Resistance,ohm,Nominal resistance value,,False
Composition,,Resistive element material,"Metal Film,Carbon Film,Thick Film",False
```

```csv
# values.csv
part_ipn,template,data,source
R-0402-10K,Resistance,10000,datasheet
```

`source` is documentation only and is not sent to InvenTree. Use it to record
where each figure came from, so a later reader can tell a datasheet value from
a supplier-listing value.

Parts are matched by IPN. An IPN that matches nothing, or matches more than one
part, is reported as a problem rather than guessed at.

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

Log output is opt-in:

```python
import logging
logging.getLogger("invimport").addHandler(logging.StreamHandler())
```

The public surface is re-exported from `invimport`: `fetch_products`,
`fetch_product`, `fetch_orders`, `fetch_sales_orders`, `line_items`,
`load_parameters`, `digikey_connect`, `inventree_connect`, `load_env`,
`load_env_file`, `Client`, `SyncResult`, `DigiKeyError`, `InvenTreeError`.

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
src/
    invimport/
        __main__.py           CLI entrypoint and subcommand registry
        cache.py              on-disk response cache
        env.py                .env loading
        digikey/
            api.py            auth, endpoints, HTTP retry, Client
            products.py       Product Information API
            orders.py         OrderStatus API
        inventree/
            api.py            connection and API 530 model overrides
            parameters.py     parameter templates and values
        commands/             thin CLI adapters over the above
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

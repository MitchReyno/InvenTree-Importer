# InvenTree-Importer

A utility for getting component data out of DigiKey and into
[InvenTree](https://inventree.org/), without hand-typing part numbers, pack
quantities and datasheet links into forms.

## Overview

Populating an InvenTree instance from scratch means gathering the same handful
of facts for every part — the manufacturer part number, packaging, minimum
order quantity, a datasheet URL — and those facts already exist in DigiKey's
API. This tool fetches them, normalises them, and loads the parts of them that
InvenTree's CSV importer cannot handle on its own. It also takes stock from
anywhere else — a receipt, a hand-written list, a drawer with no paperwork —
through a file format built to be generated as easily by an LLM as by a person.

It provides eight commands:

| Command          | What it does                                                                                                            |
|------------------|-------------------------------------------------------------------------------------------------------------------------|
| `product`        | Look up DigiKey SKUs and report packaging, pack quantity, MOQ, description, datasheet and canonical product link        |
| `orders`         | Fetch order history or a single sales order, with line items, ordered/shipped quantities, pricing and shipment tracking |
| `import-orders`  | Pick DigiKey orders from a checklist and book them into InvenTree as purchase orders                                    |
| `parameters`     | Create and update InvenTree parameter templates from `config/parameters.yaml`                                          |
| `categories`     | Create and update InvenTree part categories from `config/categories.yaml`, and learn DigiKey path aliases              |
| `supplier-parts` | Create InvenTree parts, manufacturer parts and supplier parts from DigiKey SKUs                                         |
| `discover`       | Triage supplier parameters a category is receiving but not importing                                                   |
| `import-stock`   | Import stock from a JSON/YAML/CSV file, for parts DigiKey cannot describe                                              |

Two design points worth knowing up front:

* **A DigiKey part number identifies a *variation*, not a product.** Cut tape,
  reel, tube and digi-reel are separate SKUs of the same part with different
  packaging and pack quantities. `product` resolves the SKU you asked for
  against `ProductVariations`, so the packaging reported is the one you would
  actually receive — not a property of the product in general.
* **Half of real stock has no manufacturer part number.** Measured across a
  359-row inventory: 52% have no MPN, 29% no order, 13% no supplier at all.
  `import-stock` therefore treats all three as optional and invents none of
  them — a part with an unknown manufacturer gets no ManufacturerPart rather
  than a placeholder one.
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
| `--location NAME\|PK` | Stock location to receive into (default: the only / first top-level) |
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

**Missing parts are asked about, not just reported.** An InvenTree purchase
order line points at a `SupplierPart`, which in turn needs an internal `Part`,
so a DigiKey line can only be booked if its SKU is already a supplier part
under the chosen supplier. When a selected order has SKUs that are not, the run
stops **before booking anything** and asks:

```
  3 SKU(s) in these orders are not supplier parts yet:
    296-1411-1-ND   NE555P  IC OSC SINGLE TIMER
    13-MFR-25FTE52-1RCT-ND   MFR-25FTE52-1R  RES 1 OHM 1% 1/4W AXIAL

  These lines cannot be booked without a supplier part.
  > create 3 part(s), then import the orders
    import only the line items that already match
    import nothing that has an unmatched line
```

Creating runs the same path as `invimport supplier-parts`, reusing the product
data already fetched for the selection — so it costs no extra API calls.

`--create-parts` and `--partial` answer that question up front, which is how a
non-interactive run says what it wants. Without a terminal and without either,
unmatched lines are reported with the flags that would have fixed it, and their
orders are skipped whole rather than creating a purchase order quietly missing
half of what was bought.

**Re-running is safe.** Each purchase order records its DigiKey sales order id
in `supplier_reference`, and an order already imported is recognised rather
than booked twice. Missing stock is still filled in: each line is received
as a stock item if that order does not already have one. One purchase order
is created per *sales* order, so a DigiKey order split across two shipments
produces two — that is where the line items live.

Orders are issued and received as they are imported. Stock lands in
`--location` if you name one, otherwise the only stock location on the
server (or the first top-level one, if there are several). Without a
location the purchase order is still created and stock is skipped.

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

### supplier-parts

Create the InvenTree records a DigiKey SKU needs: a `Part` (matched by
MPN or by the category's parameter signature), a manufacturer `Company`
if needed, a `ManufacturerPart`, and a `SupplierPart` with the
variation's packaging, pack quantity, and the DigiKey product page as
its link. Product photos (`PhotoUrl`) are downloaded into
`.cache/.digikey/images/` and set as the part image when the part has
none.

```bash
# dry run
uv run invimport supplier-parts 296-1411-1-ND

# apply
uv run invimport supplier-parts 296-1411-1-ND --write

# every SKU on recent orders
uv run invimport supplier-parts --from-orders --start-date 2026-01-01 --write

# from a file
uv run invimport supplier-parts - < skus.txt --write
```

**Dry run is the default.** Re-running is a no-op: a SKU that is already
a supplier part is reported and left alone. Existing parts are matched,
never renamed. `--update-parameters` overwrites parameter values on a
part that already exists.

An unmapped DigiKey category skips the SKU. An unknown manufacturer
does the same, unless you are at a terminal (fuzzy matches are offered
and written back to `config/manufacturers.yaml`) or you pass
`--create-manufacturers`.

`identity: spec` categories generate a name from the category's
`name:` template and a meaningless IPN (`R-000001`). `identity: mpn`
categories use the manufacturer part number as the name (`IC-000001`).

**Where parameter values land.** All three records carry parameters, but not
the same ones:

| Record | Carries |
|---|---|
| `Part` | the category's `key_parameters` only |
| `ManufacturerPart` | every parameter the category maps |
| `SupplierPart` | every parameter the category maps |

Only the key parameters identify a part, so only those belong on it. Everything
else — packaging, temperature range, tolerance grade — may legitimately differ
between manufacturers of the same specification, and pinning one manufacturer's
figures to the shared part would make them look authoritative. Under
`identity: mpn` there is one part per MPN, so there is no variation to keep out
and the part carries the lot.

This is why parameter templates are created with a **blank `model_type`**:
InvenTree reads that as "all models", which is what lets one `Package` template
carry a value on a part, a manufacturer part and a supplier part at once.

### discover

A new category starts with no parameters, and DigiKey sends far more than are
worth keeping — 264 distinct parameter names across the products in a modest
cache. This reports what each category is receiving and not importing, then
asks what to do with each one.

```bash
# report only
uv run invimport discover

# decide, and record the answers
uv run invimport discover --write

# one category at a time
uv run invimport discover --write --category Resistors
```

| Flag              | Effect                                                        |
|-------------------|----------------------------------------------------------------|
| `--write`         | Ask about each parameter and record the answers                |
| `--category NAME` | Only this category, by full path or leaf name                  |
| `--limit N`       | Stop after N parameters                                        |
| `--sku SKU`       | Fetch these SKUs instead of reading the product cache          |

Products come from the DigiKey product cache by default, so a report costs no
API calls.

Each parameter offers four answers, chosen with the arrow keys:

```
Resistors
  Composition  (on 38 products)
  values: Metal Film, Carbon Film, Wirewound
  looks like: 3 choices
  > key parameter    identifies the part - changes how parts are matched
    parameter        recorded on the part, not identifying
    ignore           never import this one for this category
    skip             leave undecided, ask again next time
```

Answers are written straight to `config/parameters.yaml` and
`config/categories.yaml`, so nothing is asked twice — including `ignore`, which
is recorded per category and inherited by subcategories. Units, parse mode and
choices are **suggested** from the observed values (`300 V` → `units: V`,
`±1%` → `parse: percent`), never applied on their own: filing a key parameter
changes what makes two parts the same part.

A value like `-55°C ~ 155°C` is flagged as a range, which needs two parameters
(a min and a max). Filing it records the low end; add the high one by hand.

### import-stock

Everything DigiKey cannot tell us about: parts from Rockby, Tayda, Jaycar and
eBay sellers, parts out of a drawer with no paperwork, and parts transcribed
from a photographed receipt or a hand-written list.

```bash
# check the file against the config - no API calls, nothing written
uv run invimport import-stock stock.json --validate

# dry run: ask the server what would happen
uv run invimport import-stock stock.json

# create the records
uv run invimport import-stock stock.json --write
```

| Flag                 | Effect                                                     |
|----------------------|------------------------------------------------------------|
| `--write`            | Create the records (default is a dry run)                  |
| `--validate`         | Check only, reporting as JSON with `did_you_mean` hints    |
| `--schema`           | Print the input format as JSON Schema                      |
| `--vocabulary`       | Print the category and parameter names this config defines |
| `--location PATH`    | Where stock with no location of its own goes               |
| `--on-partial MODE`  | `ask` (default), `new` or `skip` for a partial spec        |
| `--min-confidence N` | Hold any line the file rates below this, 0-1               |
| `--no-orders`        | Import the stock without creating purchase orders          |
| `--yes`              | Do not prompt; report anything ambiguous instead           |

#### The file

JSON is canonical; YAML and CSV read into the same shape. Everything except
`id`, `quantity` and `category` is optional, and that is the point — **half of
real stock has no manufacturer part number**, a third has no order, and an
eighth has no supplier at all.

```json
{
  "version": 1,
  "source": {"kind": "handwritten", "reference": "drawer-notes.jpg"},
  "defaults": {"supplier": "Rockby Electronics", "currency": "AUD",
               "location": "Workshop/Drawer A"},
  "lines": [
    {"id": "l01", "quantity": 40,
     "category": "Resistors/Through Hole Resistors",
     "parameters": {"Resistance": "4k7", "Tolerance": "1%",
                    "Power Rating": "0.25 W", "Composition": "Metal Film",
                    "Package": "Axial", "Mounting": "Through Hole"}},

    {"id": "l02", "quantity": 300, "category": "Diodes/Signal Diodes",
     "type": "1N4007", "condition": "unopened", "approximate": true,
     "supplier": "salash (eBay)", "notes": "NOS, original packaging"}
  ]
}
```

`defaults` are merged into every line and a line always wins. `order` merges
key by key, so a file-wide date with a per-line reference works.

CSV is the same shape flattened, with dotted columns for the nested parts:

```csv
id,quantity,category,type,supplier,order.reference,param.Package
l02,300,Diodes/Signal Diodes,1N4007,Rockby Electronics,R-99213,DO-41
```

A `spec` category needs *all* of its key parameters on one row, which makes for
a wide CSV; a `type` category like this one needs only the designator.

Run `uv run invimport import-stock --schema` for the full field reference.

#### Re-running is safe

Each stock item created carries a barcode naming the line that made it —
`invimport:<file id>:<line id>`. InvenTree enforces barcode uniqueness itself,
so a second run of the same file reports `already there` rather than doubling
the quantity. That is a database constraint, not a check this tool performs:
the import cannot double your stock even if the code above it is wrong.

The file id comes from `source.reference` when the file names itself, so a
regenerated file still matches; otherwise it is a hash of the contents. **Line
ids must be stable.** Renumbering them makes previously imported lines look
new, and they import a second time.

#### What it will not guess

Two situations stop and ask, with the usual arrow-key prompt:

- **An unknown category.** Existing near-matches are offered first, because
  writing `Resistors/SMD` when `Resistors/Surface Mount Resistors` exists is
  the common failure. Creating one writes to both `categories.yaml` and the
  server, or neither.
- **A partial specification.** A `spec` category identifies its parts by their
  key parameters, so a line giving only some of them can neither be matched —
  a subset match may be a different part — nor safely created, which may
  duplicate one already there. The parts that agree with what *was* given are
  offered instead.

Both refuse rather than guess because **InvenTree has no part merge**: undoing
either mistake means moving stock and deleting a part by hand.

Without a terminal, or with `--yes`, these are reported as `needs review` and
the line is left alone. Nothing is created unattended.

#### Identity, and what is optional

A line finds its part by, in order: an explicit `ipn`, an `mpn`, a `type`
designator (only where the category says `identity: type`), then the key
parameters of a `spec` category.

`type` is for designators that identify a part regardless of who made it —
`1N4007`, `2N3904`, `XR-2206`. A 1N4007 from Diotec and one from an unmarked
bag are the same part; the maker is a property of the stock.

Where the manufacturer is unknown, **no ManufacturerPart is created** — there
is no placeholder company. When you later learn who made it, adding a
manufacturer part to the existing part costs nothing: the IPN, the parameters
and the stock all stay put.

#### Conditions

`condition` may be `ok`, `unopened`, `attention`, `damaged` or `quarantined`.
`unopened` maps to InvenTree's `ATTENTION` status, which **is** in its
available-stock codes — so a sealed packet still counts toward what you have,
carrying a flag that says "not verified" rather than "unusable". Pair it with
`"approximate": true` when you are trusting a number printed on the bag.

#### Generating one with an LLM

`--vocabulary` emits the category paths, parameter names, units and choices
**from this config**, so an agent handed a photo produces values that land in
your schema instead of near it. Paired with `--validate`, whose errors carry
`did_you_mean`, an agent can iterate to a clean file without touching InvenTree
at all.

A Claude skill wrapping that loop lives in
`.claude/skills/inventree-stock-import/`.

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
`sync_templates`, `sync_config`, `sync_units`, `sync_categories`, `sync_tree`,
`from_supplier`,
`import_supplier_parts`, `match_path`, `match_name`, `load_config`,
`read_stock_file`, `validate_stock`, `import_stock`, `digikey_connect`,
`inventree_connect`, `load_env`, `load_env_file`, `Client`, `SyncResult`,
`ImportResult`, `ImportOptions`, `ConfigError`, `DigiKeyError`,
`InvenTreeError`, `StockFileError`.

Importing stock from a file, end to end:

```python
from invimport import ImportOptions, import_stock, read_stock_file, validate_stock
from invimport import load_config

document = read_stock_file("stock.json")
report = validate_stock(document, *load_config())
if not report.ok:
    raise SystemExit(report.text())

result = import_stock(document, options=ImportOptions(write=True))
print(result.counts())
```

`validate_stock` makes no API calls, so it is the cheap check to run first.

Note that `fetch_orders` and `fetch_products` write to the cache like the CLI
does, relative to the working directory. Pass `cache_dir=` if you need them
somewhere else.

## Caching

DigiKey responses are cached to disk so re-runs do not burn API quota:

```
.cache/.digikey/products/     productdetails payloads
.cache/.digikey/orders/       order history pages and sales orders
.cache/.digikey/images/       product photos, keyed by PhotoUrl
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
    suppliers.yaml            learned supplier name mappings, incl. marketplaces
src/
    invimport/
        __main__.py           CLI entrypoint and subcommand registry
        cache.py              on-disk response cache
        config.py             YAML config loading and validation
        env.py                .env loading
        stockfile.py          read a stock import file (JSON/YAML/CSV)
        validate.py           check one against the config, without the API
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
            parts.py          find-or-create Part, ManufacturerPart, SupplierPart
            purchase_orders.py  suppliers and DigiKey order import
            discovery.py      unmapped supplier parameters, and filing them
            stock.py          stock items, locations, barcode idempotence
            stockimport.py    a stock file becoming InvenTree records
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
.claude/
    skills/
        inventree-stock-import/   a Claude skill that generates a stock file
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

## Starting over

`scripts/wipe-inventory.py` deletes everything the importers load, and keeps
everything that describes it.

```bash
uv run scripts/wipe-inventory.py                # dry run: what would go
uv run scripts/wipe-inventory.py --write        # do it, backing up first
```

| Deleted                                     | Kept                          |
|---------------------------------------------|-------------------------------|
| stock items                                 | part categories               |
| purchase orders, and their line items       | companies                     |
| supplier parts                              | parameter templates           |
| manufacturer parts                          | custom units                  |
| parts                                       | stock locations               |

The kept column is the configuration you built up; the deleted column is the
data you loaded with it. So a wipe leaves you ready to import again rather than
back at an empty instance.

Three safeguards, because there is no undo through the API:

* **Dry run by default.** `--write` is required to delete anything.
* **A backup first**, via `docker exec … pg_dump`, into `backups/` (gitignored,
  since a dump contains your whole inventory). `--no-backup` skips it.
* **It refuses to start** if any build order, BOM item or sales order exists.
  Those reference parts and are not deleted here, so the wipe would fail
  half-way through — worse than not running at all.

Interactively it also asks you to type `delete`; `--yes` skips that, and
without a terminal it refuses to run unattended unless you pass it.

Assigned barcodes go with their stock item, so a wipe does not leave keys
behind that would make the next `import-stock` report `already there` and
create nothing.

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

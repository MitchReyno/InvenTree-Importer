---
name: inventree-stock-import
description: Turn a photo, receipt, invoice, hand-written list or verbal description of electronic components into a validated stock import file for InvenTree, using the invimport tool. Use this whenever the user shares a picture of components, packets, a parts invoice or a stocktake list and wants it added to their inventory, or asks to import non-DigiKey stock. Handles category and parameter matching, then validates against their real config before anything is written.
---

# InvenTree stock import

Turn an unstructured description of components — a photo, a receipt, a scribbled
list, a spoken inventory — into a JSON file that `invimport import-stock` can
check and import.

Two jobs, in that order: **transcribe, then look up**.

The file you write becomes stock records in someone's real inventory. A wrong
quantity means they build a circuit and run out of parts. A guessed
manufacturer means a part that claims a fact nobody verified. Quantity, price,
order number, and the MPN or markings as printed are transcription — when you
cannot read them, leave them out. The tool accepts partial rows, and half of
real stock genuinely has no manufacturer part number.

Once a line is identified — an MPN, a type designator, an NSN, or a complete
spec — **the part gets looked up**. Every such line should carry a datasheet,
a product image, snapshots of its sources, and every remaining parameter this
category lists in `--vocabulary` that a source actually states. The research
is done by a dedicated subagent (see
[Research: hand it to a subagent](#research-hand-it-to-a-subagent)) and the
image work by another (see
[Images: hand them to a subagent](#images-hand-them-to-a-subagent)); you
transcribe, decide, ask the user, and write the file.

## The loop

Always run from the repo root (`invimport` is not on PATH — use `uv run`):

**1. Get the vocabulary. Do this first, every time.**

```bash
uv run invimport import-stock --vocabulary
```

~26KB of JSON listing the exact category paths, parameter names, units and
choices *this* config defines. You cannot guess these — the category is
`Resistors/Through Hole Resistors`, not `Resistors/THT`; the parameter is
`Power Rating`, not `Wattage`. Read it before you write anything.

**2. Transcribe, then delegate the look-up.** Read the source and transcribe
every item (markings, label text, NSN, quantities, packaging, seal state).
Then dispatch the subagents, in the background and in parallel:

- the **research subagent** for every item you can identify — see
  [Research: hand it to a subagent](#research-hand-it-to-a-subagent);
- the **image subagent** when the user's photos are to become part or stock
  images — see [Images: hand them to a subagent](#images-hand-them-to-a-subagent).

While they work, do the existing-records check (2b) and settle questions with
the user. When the research report proposes config changes, make them — see
[When the vocabulary does not cover the part](#when-the-vocabulary-does-not-cover-the-part).

**2b. Check the server for what is already there.** Before writing a line for
a newly identified item, find out whether InvenTree already holds that part
(or stock of it). Search with every identifier you have for the item — MPN,
type designator, NSN (both the printed form and the modern 13-digit form),
drawing or house numbers, cross-referenced part numbers (e.g. `1989622-1` and
`S8T90F`), maker — from the repo root with `uv run python` and
`invimport.inventree.api.connect()`:

- parts: `Part.list(api, search=...)` for each identifier, and by name/IPN
- manufacturer parts: `ManufacturerPart.list(api, MPN=...)`
- supplier parts: `SupplierPart.list(api, SKU=...)`
- stock: each candidate part's `StockItem.list(api, part=pk)`, and stock tagged
  `nsn:<NSN>` (`api.get("stock/", params={"tags": "true", ...})`)
- the local files: `grep` the identifiers across `.local_imports/*.json`, so an
  item already in an unwritten import file is caught too

Note, per item, every candidate with its pk, IPN, name, category, MPNs and
stock (quantity, batch, location, tags), and why it might be the same part. The
check only reads; it never writes to the server.

**If anything might be the same part, stop and ask the user before writing
that line.** Show the candidates and offer: add the stock to the existing part
(use its `ipn`, or the matching `mpn`/`type`), create a new part anyway, or skip
the item. An exact match on an NSN tag plus a batch may be stock already
imported — say so. Do not decide this yourself, and do not quietly carry on
with the other lines as if the question were settled; lines with no candidates
can be prepared meanwhile. When nothing matched, say in your summary that the
check was done.

**3. Write the file** to `.local_imports/` (see the shape below). Create the
directory if it is not there. Name the file after the source — the photo,
invoice or list — not `stock.json`, so a later import does not overwrite this
one. The directory is gitignored; generated files stay local.

**4. Validate. Fix. Repeat.**

```bash
uv run invimport import-stock .local_imports/IMG_4821.json --validate
```

Returns JSON with `errors` carrying `did_you_mean`. No API calls, nothing
written — loop here as long as you need. Exit code 0 means clean.

**5. Show the dry run to the user.**

```bash
uv run invimport import-stock .local_imports/IMG_4821.json
```

Human-readable, with the parsed parameter values so they can check your reading.
**Always let the user see this before anything is written.**

**6. Only then, write — and only if the user says to.**

```bash
uv run invimport import-stock .local_imports/IMG_4821.json --write
```

**Never run `--write` without the user having seen the dry run and agreed.**
This creates real inventory records.

**7. Check what landed.** After a write, read back a stock item from each
line and confirm its tags, batch and packaging. The API omits tags unless asked:
`GET /api/stock/<pk>/?tags=true`. An empty list on a line that should be NOS
is a failure to report, not a detail.

Re-running the same file is safe: each stock item carries a barcode naming the
line that made it, and InvenTree refuses to assign one twice, so a second run
reports `already there` rather than doubling the quantity. That safety depends
entirely on line ids staying stable — see below.

A run stops and asks about anything ambiguous: an unknown category, or a part
whose key parameters are only partly given. Those prompts are for the user, not
for you. If you are running non-interactively, pass `--yes` and report the held
lines back to them.

## The file

```json
{
  "version": 1,
  "source": {"kind": "invoice-photo", "reference": "IMG_4821.jpg",
             "captured": "2026-08-29", "agent": "claude-opus-5"},
  "defaults": {"supplier": "Rockby Electronics", "currency": "AUD",
               "order": {"reference": "R-99213", "date": "2026-08-14"}},
  "lines": [
    {
      "id": "l01",
      "quantity": 25,
      "category": "Resistors/Through Hole Resistors",
      "description": "RES 100K OHM 1% 1/4W AXIAL",
      "mpn": "MFR-25FTE52-100K",
      "manufacturer": "YAGEO",
      "sku": "MFR-25FTE52-100K",
      "parameters": {"Resistance": "100 kohm", "Tolerance": "1%",
                     "Power Rating": "0.25 W", "Composition": "Metal Film",
                     "Package": "Axial", "Mounting": "Through Hole",
                     "Temperature Coefficient": "±50 ppm/°C",
                     "Max Working Voltage": "250 V",
                     "Operating Temp Min": "-55°C ~ 155°C",
                     "Operating Temp Max": "-55°C ~ 155°C",
                     "Diameter": "2.40mm x 6.30mm",
                     "Length": "2.40mm x 6.30mm"},
      "link": "https://www.yageo.com/en/ProductSearch/Search?k=MFR-25FTE52-100K",
      "datasheet": "https://www.yageo.com/upload/media/product/products/datasheet/lr/YAGEO_RCHIP_MFR_datasheets.pdf",
      "image": "https://mm.digikey.com/Volume0/opasdata/d220001/medias/images/1094/MFG_MFR-25.jpg",
      "unit_price": 0.0996,
      "packaging": "Cut Tape",
      "confidence": 0.95
    }
  ]
}
```

Run `uv run invimport import-stock --schema` for the full field reference. YAML
and CSV are accepted too; CSV uses dotted columns (`param.Resistance`,
`order.reference`).

`defaults` are merged into every line and a line always wins, so put the
supplier, currency and order there once rather than repeating them.

**Always fill `packaging`** — what this quantity is held in, written to the
stock item (50 characters max). Read it off the photo or invoice: `Cut Tape`,
`Tape & Reel`, `Tube`, `Tray`, `Anti-static bag`, `Bag`, `Box`, `Loose`. An
invoice's pack type (`CT`, `TR`, `Bulk`) counts. For new old stock it must also
say whether it is sealed — see the NOS rule below. Omit it only when nothing
shows it, and say so in your summary. The dry run does not print it.

`link` is a product or listing page (stored on the SupplierPart, and on the
Part if there is no datasheet). `datasheet` is a PDF URL (stored on the Part
and the ManufacturerPart), or a PDF path relative to the stock file, which is
attached to both as a file. `datasheet_pages` (`"140-142"`, `"3, 5-6"`)
attaches those 1-based pages of that PDF as the datasheet, with the whole
document beside it. `image` is a product photo: an `http(s)` URL, or a
path relative to the stock file. Extra photos go in `images`: `image` becomes
the Part's picture and each of the rest is uploaded as a Part attachment, once
per part however many lines list it. A missing or unreadable image is skipped
— it does not fail the import.

`stock_images` are photos of *this quantity* rather than of the part — the
packet a batch came in, its label and date code — attached to the stock item
the line creates (and to an already-imported line's item on a re-run, skipping
names it already has). When one part arrives as several batches, give the part
one representative `image` and each line a `stock_images` crop of its own
batch's packet, so the stock items can be told apart.

`location` is a stock location path (`"Storage/Bags/MDA920A3"`). Any part of it
that does not exist is created, with its parents, on `--write`; the dry run
marks such a line `(new location)` so the user sees the new location before
anything is made.

## Research: hand it to a subagent

Looking parts up — identifying them, finding datasheets and data-book pages,
NSN and CAGE records, cross-references, parameters, and snapshotting every
source page — is done by a **dedicated research subagent**, not by you. It is
long, search-heavy work that fills a context with page dumps; keeping it out
of yours leaves room for the user, the existing-records check and the file.
Do not research parts yourself beyond a quick check of the report, and do not
skip the subagent because an item looks easy.

1. **Build the prompt** from
   [templates/research-subagent-prompt.md](templates/research-subagent-prompt.md):
   copy its base prompt and fill in the Job section — the import file, the
   snapshot folder `.local_imports/snapshots/<import id>/`, a scratch
   directory, and per item the line id(s) and **everything you transcribed**
   (label text verbatim, markings, NSN, CAGE/FSCM, contract, date codes,
   packaging), whether a device photo exists, and any question to settle. The
   subagent knows nothing you do not write there. One subagent can take a
   whole batch; for a large batch, split by item so several run in parallel.
   Run them with the Agent tool (`general-purpose`) in the background.
2. **The subagent reads
   [COMPONENT_RESEARCH.md](COMPONENT_RESEARCH.md) first** — the memory that
   carries site quirks, data-book page offsets, decoded CAGE codes and traps
   between research runs. The base prompt tells it to; you keep it current
   (step 5).
3. **Apply the report.** For each line: `category`, `manufacturer`,
   `mpn`/`type`, `description`, `datasheet` (+ `datasheet_pages`), `link`,
   `image` (a URL only when there is no photo of the device), `parameters`,
   `attachments` (the snapshot paths with their comments), `confidence`, and
   the facts for `notes`. Write notes as plain facts. Suggest
   `--mirror-datasheets` when the report says a datasheet lives on a mirror.
4. **Check before you trust.** Spot-check that the snapshots exist and that a
   few key values match the cited page; anything that looks constructed
   rather than found goes back to the subagent or is left out. Same-part
   evidence in the report is a question for the user (see 2b), never a
   decision. Proposed config changes go through
   [When the vocabulary does not cover the part](#when-the-vocabulary-does-not-cover-the-part).
5. **Update [COMPONENT_RESEARCH.md](COMPONENT_RESEARCH.md)** with the report's
   learnings: merge each into the right section, drop duplicates of what is
   already there, correct entries the new run disproved, date anything that
   may go stale, and keep it short — it is read in full at the start of every
   research run. Do this every time, before reporting to the user.

When the user later corrects or adds an item that needs looking up, that is a
research job too.

### When the vocabulary does not cover the part

The vocabulary was grown from the parts already imported, so a new kind of
part often has attributes it cannot express yet. The research subagent reports
these as proposed config changes; you weigh them and edit the config. Ask what
someone would search, filter or substitute this part by: if the category does
not store it, extend the config rather than dropping it into `notes` and
moving on. Notes are fine for provenance, but nobody can filter on them.

Some typical gaps:

- **A missing choice.** A `choices` parameter refuses anything outside its
  list, so `Memory Format` holding only `FLASH` rejects a PROM outright. Add
  the value this part needs, spelled the way DigiKey spells it so later
  DigiKey imports land on the same choice.
- **A missing parameter.** Access time on a memory, frequency on a crystal,
  forward voltage on an LED, gain on a transistor. Before inventing a name,
  search the whole `parameters` list in the vocabulary: another category may
  already define it, and reusing that template is always better than a
  near-duplicate. Otherwise add it to `config/parameters.yaml` with `units`,
  a `description` and the DigiKey spelling in `aliases`, then add it to the
  category's `parameters` in `config/categories.yaml`.
- **A parameter that is wrong for the part.** A unit that cannot express
  the value (`Memory Size` in `Mbit` for a 4 Kbit PROM), or a description
  that only fits the parts seen so far. Fix the config instead of forcing
  the value into a shape that misrepresents it.

Keep it proportionate. Add what identifies or distinguishes the part, and
leave trivia (lead finish, marking colour) in `notes`. Adding to a
`key_parameters` list changes how existing parts in a `spec` category are
matched, so propose that to the user and never do it silently.

The YAML files are the source of truth, and editing them changes nothing on
the server. `import-stock` never creates templates. Push the config with:

```bash
uv run invimport categories          # dry run: units, templates, categories
uv run invimport categories --write  # apply
```

Include this in what the user reviews alongside the import dry run, since it
also writes to their InvenTree. It has to run before the import's `--write`,
or the new values have no template to be stored against. When you report back,
list each config change and the line that prompted it.

## Images: hand them to a subagent

All image processing — cropping the user's photos into part and stock images,
recropping, building montages, filing the originals — is done by a
**dedicated subagent**, not by you. Image work is long, fiddly and
token-heavy (previews, ROIs, montage reviews), and keeping it out of your
context leaves room for the transcription, research and the user's questions.
The rules for the work itself live in the `component-photo-crops` skill; the
subagent loads it. Do not crop images yourself, and do not skip the subagent
because a job looks small.

When the user's photos show components, packets or labels, each is a real
image for its line, better than a distributor's stock shot: it is the part
they actually hold, with its own markings, label and date code. So:

1. **Read the photos yourself first.** Transcription stays with you —
   markings, labels, tags, seal state, quantities. Zooming in to read is fine
   and is not image processing.
2. **Decide what each line needs**: the part's `image` (the device, or the
   packet when no device was photographed), each batch's `stock_images`, a
   group shot for `images`, and what must stay out of frame (price or count
   tags, hands, other lots).
3. **Dispatch the subagent** with the Agent tool (`general-purpose`). Build
   the prompt from [templates/image-subagent-prompt.md](templates/image-subagent-prompt.md): copy
   its base prompt and fill in the Job section — the import file, the output
   folder `.local_imports/photos/<import id>/`, a scratch directory, every
   source photo by absolute path with a note on what it shows, every wanted
   output (line, field, content, suggested name), and whether it is a redo.
   The subagent knows nothing you do not write there. One subagent can take a
   whole batch of photos; run it in the background and carry on with research
   and the existing-records check while it works.
4. **Apply its report.** Put the returned paths into the lines' `image`,
   `images` and `stock_images`, update every reference to a path it says
   changed, and open its montage to check the crops yourself before showing
   the user the dry run. Pass on what it flagged — soft images, non-square
   crops, partly legible labels.

Reference images relative to the stock file
(`"photos/168844/l04-f4520bpc.jpg"`); the per-import folder stops two imports
that both number from `l01` overwriting each other's photos. When the user
asks for crops to be redone, that is a job for the subagent too.

**Replacing an image on a part that is already imported.** `attach_part_image`
skips any part that already has one, so call `part.uploadImage(path)` directly.
Resolve the part through the line's barcode
(`invimport:<file_id>:<line id>` → stock item → part) and check the part's name
before uploading, so a mismatch cannot put a photo on the wrong record.
InvenTree may report the *same* filename afterwards, which is equally what you
would see if it had kept the old file: fetch the image back from the server and
compare hashes before telling the user it worked.

## Rules that matter

**Never invent.** Quantity, price, order number, and the MPN, manufacturer or
markings as printed: only what you can see on the source. A datasheet you
opened for this part is not invention; a datasheet for a similar-looking part
is. A parameter copied from "typical 100k 1/4W metal film" without checking
this part's datasheet is invention. Omit anything you did not find. A part
with no manufacturer is normal and gets no ManufacturerPart — that is the
designed behaviour, not a degraded one. The cost is that such a part cannot
be found again by its MPN: when a later line names an MPN that only matches an
existing part by name, the import asks the user whether to use it, create a
new part or skip the line, and holds the line for review under `--yes`.

**Every line needs a stable, unique `id`.** With `source.reference`, it forms
the barcode that makes re-running an import a no-op instead of doubling the
stock. Use `l01`, `l02`… in reading order, and set `source.reference` to the
photo or invoice filename.

If you regenerate the file later, **keep the ids you already used** — append new
ones rather than renumbering. Renumbering makes previously imported lines look
new, and they will import a second time. This is the single most damaging
mistake available to you here.

**Categories come from `--vocabulary`, exactly as written.** If nothing fits,
still name the category you want and add `suggest_category`; the import will
offer close matches first and prompt before creating anything:

```json
"category": "Capacitors/Mica Capacitors",
"suggest_category": {"identity": "spec", "ipn_prefix": "CAP",
                     "because": "not a film or ceramic dielectric"}
```

`because` is shown to the human confirming and never stored. Prefer an existing
category — inventing `Resistors/SMD` when `Resistors/Surface Mount Resistors`
exists is the most common failure.

**Fill every `key_parameter` for `spec` categories.** The vocabulary lists them
per category. Under `identity: spec` those parameters *are* the part's identity,
so a partial set makes the import stop and ask a human rather than guess. Read
them off the packet first; if any are missing, take them from the datasheet.
Only leave the line partial if neither source has them.

**Write values as they are printed.** `"4.7 kohm"`, `"±1%"`, `"0.25 W"`,
`"-55°C ~ 125°C"`. Units are parsed, not assumed. Do not normalise to bare
numbers.

**Use `type` for type designators.** `1N4007`, `2N3904`, `XR-2206`, `IN-1` go in
`type`, not `mpn`. A JEDEC number identifies a generic part regardless of who
made it; an MPN belongs to one manufacturer. A `type` with a `manufacturer`
still records that manufacturer: the designator becomes its MPN.

**Every line with a supplier needs a `sku`.** The supplier is only stored
through a SupplierPart, and there is no SupplierPart without a SKU - leave it
out and the stock silently forgets where it came from. Use the seller's
catalogue number; if they have none (surplus dealers usually don't), use the
part number or type as printed. The validator warns when one is missing.

**eBay purchases:** `"supplier": "eBay"`, with the seller name in `notes`. Do
not create a supplier per seller.

**Ask before grouping several stock items of one part into a new location.**
When a file creates more than one stock item for the same internal part —
several batches, or sealed and opened quantities as separate lines — the user
often keeps them together in one bag. Ask, in **one** question, whether to
group them into a new location and what to call it, offering:

- the part name and a common identifier the stock items share, joined by an
  em dash (`MDA920A3 — 5961-00-782-7187`, using the NSN, a DEC or house
  number) — the usual choice when there is such an identifier
- the part name or MPN alone (`MDA920A3`)
- keep them where they would otherwise go (no new location)

with free text for any other name. The location is top-level — not nested
under another location — unless the user says otherwise, so the `location`
path is just the name. Give every one of those lines that same path; the
importer creates it once. Do not group silently, and do not ask for a part
that only has one stock item.

**Record the order when the source shows one.** An invoice or receipt gives you
a `reference`, usually a date, and often a scan worth keeping:

```json
"order": {"reference": "INV-88213", "date": "2026-03-14",
          "invoice": "scans/inv-88213.pdf", "notes": "paid on collection"}
```

Use the seller's own invoice number as `reference`, and give every line from the
same invoice the same one — they will share a single purchase order. Dates are
`YYYY-MM-DD`. If the user gave you the invoice as a file, name it in `invoice`
with a path relative to the stock file and it is attached to the order.

**Never invent a reference.** A line with no order reference gets no purchase
order, which is correct: plenty of stock arrives without one, and a made-up
number is a record of a purchase that did not happen that way. Put it in
`defaults` when a whole file came off one invoice.

**New old stock must be tagged `NOS` and `new old stock` — every line, no
exceptions.** This is not optional labelling: it is how the user finds and
filters their NOS, and a missed tag makes the stock indistinguishable from
current production. Treat a line as NOS when any of these hold:

- it is unused and the part is obsolete or long out of production
- it comes from a surplus or military-disposal source (MacService Group, a
  surplus dealer, an estate lot)
- it carries an NSN, a FSCM/CAGE label, a MIL/JAN part number, or DLA
  contract markings
- its date code or packaging date is years old

When unsure, ask the user; do not quietly leave it off. Used or pulled parts
are not NOS — tag those `used` / `pulled` instead.

NOS is tags plus a batch code, never a part flag. It goes on the stock item:

```json
"tags": ["NOS", "new old stock"], "batch": "8231",
"packaging": "Tube, sealed", "condition": "unopened",
"notes": "surplus dealer"
```

Use **both** spellings, `NOS` and `new old stock`, so either search finds it.
Put the date code in `batch` if the packaging or the chips show one — `8231` is
week 31 of 1982 — and say in `notes` where it came from. Never record this as a
part parameter: the same component may arrive as current production next time,
and a part attribute would then be wrong for every quantity you hold.

**NOS needs `packaging` stating both the kind and the seal state** — `Tube,
sealed`, `Anti-static bag, opened`, `Tray, resealed`, `Reel, unsealed`.
Validation refuses an NOS line without both. Read the state off the photo: an
intact factory seal, label or heat-seal is `sealed`; a cut or torn one is
`opened`; tape over a cut is `resealed`. If you cannot see it, ask the user
rather than guessing `sealed` — it is the strongest claim the line makes.

**An NSN goes in as a tag, `nsn:<NSN>`** — `nsn:5961-00-123-4567` — but only
when it is already in front of you: printed on the label or packet, on the
invoice, or given by the user. Do not search for one, look one up from the part
number, or ask the user for it; a line with no visible NSN simply has no NSN
tag. The importer normalises the spacing and refuses anything that is not 13
digits, so copy the digits exactly as shown.

**Do not repeat packaging in `tags`.** No `sealed tube`, `tube`, `reel`,
`sealed` or `opened` tag when `packaging` already says it — the importer writes
tags exactly as given, so a duplicate lands in InvenTree and drifts out of step
with the packaging field. Tags are for what the packaging field cannot say:
`NOS`, `surplus`, `used`, `pulled`, `nsn:…`.

```json
"packaging": "Tube, sealed",
"tags": ["NOS", "new old stock", "nsn:5961-00-123-4567"]
```

not `"tags": ["NOS", "new old stock", "sealed tube"]`.

Set them in `defaults` when a whole delivery is NOS. File-wide `tags` merge with
a line's own rather than replacing them, so per-line labels like `surplus`
can be added freely.

The dry run does not print tags, so say in your summary which lines carry
`NOS` — the user cannot see it anywhere else before the write.

**Prices are ex-tax, per piece.** If an invoice shows a line total, divide by the
quantity. If it is tax-inclusive and you cannot separate the tax, omit
`unit_price` rather than recording a wrong one.

## Reading quantities honestly

This is where a wrong answer does real damage.

- Counted individually → exact `quantity`
- Estimated by eye, weight, or "about half a reel" → set `"approximate": true`
- Sealed or unopened packet → `"condition": "unopened"`, and usually
  `"approximate": true` as well, since you are trusting the label

`unopened` stock still counts as available — it is a flag saying "not verified",
not a block. So an inaccurate figure on a packet propagates into their totals
until they open it. Say in your summary which quantities you did not verify.

## Confidence

Set `confidence` (0–1) and `needs_review` honestly. Neither is ever written to
InvenTree — they exist so a human knows where to look. A blurry marking you are
guessing at should be `0.4` with `"needs_review": true`, not `0.9`.

## By source

**Invoice or receipt photo** — the richest source. Expect distributor part
numbers, MPNs, quantities and prices. Put the order number and date in
`defaults.order`. Watch for pack quantities in the description (`"10-pack"`)
where the line quantity is packs, not pieces: the import wants **pieces**. An
MPN on an invoice is enough to look the part up; send it to the research
subagent before writing the file.

**Hand-written list** — usually value, quantity and not much else. Resistors and
capacitors are `spec` categories, so a value plus tolerance plus wattage may be
a complete identity with no MPN at all. Ask about ambiguous shorthand rather
than guessing: `4k7`, `4R7` and `47k` are three different resistors. Send a
line for research only when it is identified well enough that a datasheet could
only be this part.

**Photo of the components themselves** — read markings literally and transcribe
them into `type` or `description`. Do not "correct" a marking into a part you
recognise unless you are certain. Colour-code a resistor only if the bands are
unambiguous in the image; say when you are inferring rather than reading. A
legible MPN or type is enough to research; a photo of the bag is not the part
image, but a clear shot of the component itself is — have each one cropped
out per [Images: hand them to a subagent](#images-hand-them-to-a-subagent). Markings on the
component beat the invoice: a surplus dealer's catalogue number often names a
part they no longer stock, and the chip in the tube is what the user owns.

**Verbal or typed description** — ask for what is missing before writing the
file, particularly quantities and whether packets are sealed. Send anything
identified for research.

## When you are done

Report to the user:

- how many lines, and the dry-run output
- **anything you guessed, inferred or could not read** — list these explicitly
- which lines have no `datasheet` or `image`, and why (unidentified, or looked
  up and not found)
- what the image subagent produced and flagged (non-square crops, soft
  images, partly legible labels)
- any line the validator warned about, especially partial `spec` identities that
  will make the import stop and ask
- which source pages were snapshotted and attached, and any you could not
  capture (and why)
- what the research subagent could not find or settle, and which of its
  learnings you added to `COMPONENT_RESEARCH.md`
- the result of the existing-records check for each new item, and what the
  user decided about any match
- any parameter or choice you added to the config, and the command that
  pushes it to the server
- whether anything was written, and what

Do not claim stock was imported unless you ran `--write` and it reported
`created`. A dry run has written nothing.

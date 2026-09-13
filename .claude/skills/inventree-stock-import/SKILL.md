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

Once a line is identified — an MPN, a type designator, or a complete spec —
**look the part up**. Every such line should carry a datasheet URL, a product
image, and every remaining parameter this category lists in `--vocabulary`
that the datasheet or product page actually states. A URL you did not open,
or a parameter you filled from "typical 100k 1/4W metal film", is invention.

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

**2. Identify, then look up.** Read the source. For every line you can
identify, fetch (do not invent) a datasheet URL, one product image, and the
category's remaining parameters — see [Looking a part up](#looking-a-part-up).

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

`link` is a product or listing page (stored on the SupplierPart, and on the
Part if there is no datasheet). `datasheet` is a PDF URL (stored on the Part
and the ManufacturerPart). `image` is a product photo: an `http(s)` URL, or a
path relative to the stock file. Extra photos go in `images`. A missing or
unreadable image is skipped — it does not fail the import.

## Looking a part up

Do this for every line you can identify. An MPN (`MFR-25FTE52-100K`), a type
designator (`1N4007`), or a complete spec (value, tolerance, wattage,
composition, package, mounting) is enough to search on. A bag that only says
`4k7` is not — transcribe what is there and leave `datasheet`, `image` and
extra parameters off.

**Open the sources. Copy what they actually say.** Do not construct a
datasheet URL from a manufacturer's typical path, and do not fill parameters
from memory of the series. If you cannot fetch a page, omit the field and say
so in your summary.

For each identified line:

1. **Datasheet.** Search for this MPN or type plus "datasheet". Prefer the
   manufacturer's PDF for this part or series. Put the URL you opened in
   `datasheet`. A distributor product page is `link`, not a datasheet. A PDF
   for a similar-looking part (another 100k resistor, another 1N400x) is
   wrong — leave `datasheet` off.
2. **Image.** One product photo of this part, in `image`. Manufacturer or
   distributor is fine. The photo the user sent you is the *source*, not the
   part image — unless it is a clear picture of this one component, in which
   case crop that component out and use it; see
   [Cropping a component photo](#cropping-a-component-photo). A path relative
   to the stock file is accepted (`"packets/l01.jpg"`).
3. **Parameters.** The vocabulary lists every parameter this category stores,
   not just the `key_parameters` that identify it. Read the datasheet and
   product page, and fill every one of those names they actually state —
   temperature coefficient, voltage rating, operating temperature, body size,
   and so on. Use the vocabulary's names (`Power Rating`, not `Wattage`) and
   write values as printed (`"±50 ppm/°C"`, `"-55°C ~ 155°C"`,
   `"2.40mm x 6.30mm"`). Skip any parameter the source does not give; do not
   round out the set from a typical part.

A line that already has its key parameters from the packet still needs this
pass: the packet rarely has a datasheet URL or a TCR.

## Cropping a component photo

When the user photographs the components, each component in that photo is a
real product image for its line, and a better one than a distributor's stock
shot: it is the part they actually hold, with its own markings and date code
visible. Put the path in that line's `image`.

**Crop only when the photo needs it.** One component per photo, already framed
against a plain background, is finished — use it as it is. Cropping earns its
place when one photo holds several components, or when the part is lost in a
wider scene. Trimming a little whitespace off an image that was already fine is
work the user did not ask for and did not want. Zooming in to *read* a marking
is a different thing and always fine; it just does not have to become the
stored image.

Write crops to `.local_imports/photos/<invoice>/`, named for the line and the
part (`l04-f4520bpc.jpg`), and reference them relative to the stock file
(`"photos/168844/l04-f4520bpc.jpg"`). The per-invoice subdirectory is not
tidiness: two imports both numbering from `l01` will otherwise overwrite each
other's photos.

**Find the bounds, do not guess them.** Fractions eyeballed off the full image
are the most common way these come out wrong, and the error is invisible until
you look at the result.

- **A collage** — several photos tiled into one image — splits on its white
  gutters, not at the midpoint. The panels are usually unequal, so the
  midpoint cuts through one of them. Find the columns and rows that are
  near-white across the whole image and cut there.
- **Loose components on a plain background** — threshold the dark bodies and
  take the bounding box of each connected region. Discard the blobs that are
  background rather than parts; a dark corner of the room is bigger than any
  chip.

**Include the leads.** A bounding box on the body alone cuts the pins off, and
a DIP with no legs is a worse picture than the stock photo you passed over.
Expand well past the bottom of the body — the leads are roughly as tall again.

**Then look at the crops.** Build a montage of all of them and read it. You are
looking for a neighbouring component intruding at an edge, clipped leads, and
dead space. Tighten the offenders and look again; a second pass is normal
rather than a sign the first attempt was careless.

**A photo taken through a tube stays soft.** Upscaling adds pixels, not detail.
Say so in your summary instead of presenting it as a good image — a fresh
close-up of one chip out of the tube is the only real fix, and the user can
decide whether it is worth taking.

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
designed behaviour, not a degraded one.

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
made it; an MPN belongs to one manufacturer.

**eBay purchases:** `"supplier": "eBay"`, with the seller name in `notes`. Do
not create a supplier per seller.

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

**New old stock is tags plus a batch code, never a part flag.** Unused but old
stock — vintage ICs, a surplus dealer's sealed tubes, anything bought long after
it stopped being made — is tagged on the stock item:

```json
"tags": ["NOS", "new old stock"], "batch": "8231",
"condition": "unopened", "notes": "sealed tube, surplus dealer"
```

Use **both** spellings, `NOS` and `new old stock`, so either search finds it.
Put the date code in `batch` if the packaging or the chips show one — `8231` is
week 31 of 1982 — and say in `notes` where it came from. Never record this as a
part parameter: the same component may arrive as current production next time,
and a part attribute would then be wrong for every quantity you hold.

Set them in `defaults` when a whole delivery is NOS. File-wide `tags` merge with
a line's own rather than replacing them, so per-line labels like `sealed tube`
can be added freely.

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
MPN on an invoice is enough to look the part up; do that before writing the
file.

**Hand-written list** — usually value, quantity and not much else. Resistors and
capacitors are `spec` categories, so a value plus tolerance plus wattage may be
a complete identity with no MPN at all. Ask about ambiguous shorthand rather
than guessing: `4k7`, `4R7` and `47k` are three different resistors. Look the
part up only when the line is identified well enough that a datasheet could
only be this part.

**Photo of the components themselves** — read markings literally and transcribe
them into `type` or `description`. Do not "correct" a marking into a part you
recognise unless you are certain. Colour-code a resistor only if the bands are
unambiguous in the image; say when you are inferring rather than reading. A
legible MPN or type is enough to look up; a photo of the bag is not the part
image, but a clear shot of the component itself is — crop each one out per
[Cropping a component photo](#cropping-a-component-photo). Markings on the
component beat the invoice: a surplus dealer's catalogue number often names a
part they no longer stock, and the chip in the tube is what the user owns.

**Verbal or typed description** — ask for what is missing before writing the
file, particularly quantities and whether packets are sealed. Look up anything
identified.

## When you are done

Report to the user:

- how many lines, and the dry-run output
- **anything you guessed, inferred or could not read** — list these explicitly
- which lines have no `datasheet` or `image`, and why (unidentified, or looked
  up and not found)
- any line the validator warned about, especially partial `spec` identities that
  will make the import stop and ask
- whether anything was written, and what

Do not claim stock was imported unless you ran `--write` and it reported
`created`. A dry run has written nothing.

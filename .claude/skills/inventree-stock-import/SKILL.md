---
name: inventree-stock-import
description: Turn a photo, receipt, invoice, hand-written list or verbal description of electronic components into a validated stock import file for InvenTree, using the invimport tool. Use this whenever the user shares a picture of components, packets, a parts invoice or a stocktake list and wants it added to their inventory, or asks to import non-DigiKey stock. Handles category and parameter matching, then validates against their real config before anything is written.
---

# InvenTree stock import

Turn an unstructured description of components — a photo, a receipt, a scribbled
list, a spoken inventory — into a JSON file that `invimport import-stock` can
check and import.

Your job is **transcription, not invention**. The file you write becomes stock
records in someone's real inventory. A wrong quantity means they build a circuit
and run out of parts. A guessed manufacturer means a part that claims a fact
nobody verified. When you cannot read something, leave it out — the tool is
built to accept partial rows, and half of real stock genuinely has no
manufacturer part number.

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

**2. Write the file** (see the shape below).

**3. Validate. Fix. Repeat.**

```bash
uv run invimport import-stock stock.json --validate
```

Returns JSON with `errors` carrying `did_you_mean`. No API calls, nothing
written — loop here as long as you need. Exit code 0 means clean.

**4. Show the dry run to the user.**

```bash
uv run invimport import-stock stock.json
```

Human-readable, with the parsed parameter values so they can check your reading.
**Always let the user see this before anything is written.**

**5. Only then, write — and only if the user says to.**

```bash
uv run invimport import-stock stock.json --write
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
                     "Package": "Axial", "Mounting": "Through Hole"},
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

## Rules that matter

**Never invent.** No MPN, manufacturer, order number, price or parameter value
that you cannot actually see. Omit the field. A part with no manufacturer is
normal and gets no ManufacturerPart — that is the designed behaviour, not a
degraded one.

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
so a partial set makes the import stop and ask a human rather than guess. If the
information is on the packet, read it; if it genuinely is not there, leave the
line partial and expect the prompt.

**Write values as they are printed.** `"4.7 kohm"`, `"±1%"`, `"0.25 W"`,
`"-55°C ~ 125°C"`. Units are parsed, not assumed. Do not normalise to bare
numbers.

**Use `type` for type designators.** `1N4007`, `2N3904`, `XR-2206`, `IN-1` go in
`type`, not `mpn`. A JEDEC number identifies a generic part regardless of who
made it; an MPN belongs to one manufacturer.

**eBay purchases:** `"supplier": "eBay"`, with the seller name in `notes`. Do
not create a supplier per seller.

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
where the line quantity is packs, not pieces: the import wants **pieces**.

**Hand-written list** — usually value, quantity and not much else. Resistors and
capacitors are `spec` categories, so a value plus tolerance plus wattage may be
a complete identity with no MPN at all. Ask about ambiguous shorthand rather
than guessing: `4k7`, `4R7` and `47k` are three different resistors.

**Photo of the components themselves** — read markings literally and transcribe
them into `type` or `description`. Do not "correct" a marking into a part you
recognise unless you are certain. Colour-code a resistor only if the bands are
unambiguous in the image; say when you are inferring rather than reading.

**Verbal or typed description** — ask for what is missing before writing the
file, particularly quantities and whether packets are sealed.

## When you are done

Report to the user:

- how many lines, and the dry-run output
- **anything you guessed, inferred or could not read** — list these explicitly
- any line the validator warned about, especially partial `spec` identities that
  will make the import stop and ask
- whether anything was written, and what

Do not claim stock was imported unless you ran `--write` and it reported
`created`. A dry run has written nothing.

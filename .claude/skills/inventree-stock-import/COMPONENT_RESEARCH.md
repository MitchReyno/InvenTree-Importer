# Component research memory

Read by every component-research subagent before it starts; added to by the
main stock-import agent from each subagent's "Learnings" section. Keep entries
short, specific and reusable. Dedupe and correct rather than append
contradictions, and date anything that may go stale (`(2026-10)`).

## NSN / FLIS lookup sites

- **nsnparts.us** — plain `curl` works:
  `https://nsnparts.us/parts/nsn/<13-digit NSN>.html`. Gives the
  cross-reference (part number, CAGE, company), assignment date and full FLIS
  characteristics; snapshots cleanly. Some NSNs return a stub page reading
  "could not find the INC xml file" — use another site. (2026-10)
- **NSN Depot** — plain `curl` works:
  `https://www.nsndepot.com/NSN/5962-01-014-9628` (dashed form). Gives the
  MCRL with RNCC/RNVC codes (which number is the design-control one, which is
  "replaced/discontinued") and the **replacement NSN and date** when an NSN has
  been superseded. Large snapshot (~3.5 MB). (2026-10)
- **ISO Group** — `https://www.iso-group.com/NSN/<dashed NSN>`. Has
  characteristics for cancelled/replaced NSNs that other sites drop; plain
  `curl` worked in 2026-10 for some NSNs, others needed a browser.
- **WBParts** — needs a browser (browser-harness), then `--from-html`.
- **nsncenter.com** — returns a JavaScript redirect stub to `curl`; not worth
  the trouble when the sites above work.
- **DLA / WebFLIS** — gated behind a consent banner. Never click it through;
  record the source as a link only.
- A cancelled NSN often names its replacement; the replacement's record may
  list the same part numbers (e.g. MDA920-3's NSN was cancelled in favour of
  5961-00-782-7187). Check both when deciding "same part".
- tedss.com and cage.report sit behind a Cloudflare challenge that
  browser-harness does not pass. (2026-10)
- A pre-1974 FSN (`5905-806-4769`) is the NSN with `00` inserted
  (5905-00-806-4769). FLIS "rotary actuator travel 9000 deg" = 25 turns.

## Data books and datasheets

- **bitsavers** data books: browse directories through the mirror
  `https://ftp.mirrorservice.org/sites/www.bitsavers.org/components/<maker>/_dataBooks/`
  (the listing is plain HTML); link datasheets with the canonical
  `https://bitsavers.org/components/...` URL.
- To find a device in a scanned book: `pdftotext -f N -l N -layout` page by
  page (poppler is installed), `grep -l` the part number, then read the hits.
  The index's printed page numbers do not match PDF pages — always report PDF
  pages for `datasheet_pages`. OCR mangles µ, ° and fractions (`'h`, `\I,`).
- Known locations:
  - Micro Networks 1992 *Data Conversion Products*: MN3000 series 8-bit DACs
    (MN3000/3001/3002/3006) at PDF pp. 413-416; MN7130 track-hold mux is in the
    same book (pages 9-9 to 9-14 printed).
  - Fairchild 1970 *Integrated Circuit Data Catalog*: DTµL 9941/9951
    monostables at PDF pp. 148-150, package outlines p. 151. Fairchild's DTµL
    99xx numbers are the industry 9xx DTL types (9951 = 951, 9930 = 930).
  - Motorola 1983 DL125R1 *Rectifiers and Zener Diodes* covers MDA920 bridges
    (pp. 261-264 used).
  - Transitron SF67 condensed catalogue (bitsavers) for Transitron types.
  - TI 1981 *Interface Circuits Data Book* 2ed: SN75160A at PDF pp. 335-340
    (SN75161A/162A from 341), N plastic DIP outlines pp. 34-35 (20-pin on 35),
    J ceramic pp. 32-33, interchangeability guide from p. 12.
  - TI 1972 *Power Semiconductor Data Book* 1st ed: 2N1595-2N1599 SCRs at
    PDF pp. 648-651 (JEDEC data, TO-5).
  - ADI 1989 *DSP Products Databook*
    (`components/analogDevices/_dataBooks/`): ADSP-1010A PDF pp. 319-324,
    ADSP-1010B pp. 325-329; package outlines from p. 385 (printed 6-n = PDF
    383+n; D-64A side-brazed DIP p. 389). The 1987 book
    (`components/analogDevices/dsp/`) has the A only. OCR renders "1010" as
    `lOlO`/`IOIO` — grep `(1|l|I)0(1|l|I)0`.
- `datasheet_pages` takes comma lists, so a data-sheet range and a separate
  outline page combine: `"325-329, 389"`.
- DLA SMD PDFs (`landandmaritimeapps.dla.mil/Downloads/MilSpec/Smd/<n>.pdf`)
  redirect to a gated DLA landing page — treat as gated. (2026-10)
  - Allen-Bradley Series 314/316 cermet I-DIP networks: archive.org item
    `manuallib-id-2591722` (3 pp; p.3 = 314E/316E dual terminators, part
    number = series + R1 code + R2 code).
- **archive.org** advanced search works with plain curl:
  `https://archive.org/advancedsearch.php?q=<terms>&fl[]=identifier&fl[]=title&rows=50&output=json`;
  each item's `_djvu.txt` is greppable OCR. `manuallib-id-*` items are ICminer
  scans of maker sheets. (2026-10)
- alldatasheet search results are built by JavaScript: read them in
  browser-harness from `a[href*=datasheet-pdf]` (curl gets a 5 KB shell).
- No Bourns 260-series trimmer datasheet survives online (checked current
  Trimpot catalogue, 1976 and 1989 catalogues, alldatasheet). (2026-10)
- littlediode.com "product photos" are generic blank-top DIP stock shots — not
  photos of the exact part.
- Datasheet Archive downloads use signed, expiring URLs — download the PDF to
  `.local_imports/datasheets/` and attach the local file instead of linking.
- MIL-M-38510 slash sheets (e.g. on TI's e2e file store) document JM38510
  parts when no maker datasheet survives.

## CAGE / FSCM codes seen

- 04713 Motorola (now listed as Freescale/NXP)
- 07263 Fairchild Semiconductor
- 01295 Texas Instruments
- 12115 DRS ICAS (design-control numbers like SC5962-…)
- 13499 Rockwell Collins Government Systems (351-xxxx-010 house numbers)
- 14433 ITT Semiconductors
- 35351 GE Aviation Systems
- 49956 Raytheon (JM38510 lots)
- 50507 Micro Networks (Worcester MA; later Spectrum Microwave)
- 54485 Microsemi Corp. – Massachusetts (Microsemi Lawrence; TS-xxxx numbers)
- 88818 Kearfott (C528… drawing numbers)
- 00724 Raytheon (72-xxxxx-xxx numbers)
- 01121 Allen-Bradley (now listed as Rockwell Automation)
- 80294 Bourns Instruments
- 80131 Electronic Industries Association (JEDEC 1N/2N types; design control)
- 27014 National Semiconductor
- 28480 Hewlett-Packard; 1LQK8 Agilent/Keysight
- 54418 Miltope Corp
- 03508 GE Semiconductor Products; 12969 Micro USPD; 30043 Solid State Devices
- 80183 Sprague; 2S894 Digi-Key; 80009 Tektronix; 81349 military specs
- 51640 Analog Devices Microelectronics Div (DSP-era NSNs, not 24355)
- 81413 BAE Systems IESI; 65786 Cypress; 65896 Logic Devices; 61772 IDT
- 67268 DLA Land and Maritime (SMD 5962-xxxxx numbers)

## Labels, markings and packaging

- DLA packet labels read: NSN, FSCM/CAGE + MFR P/N, item name, unit of issue,
  contract (`DLA900-85-M-SK76`), then a line like `A 4/86` / `A- 11/87` /
  `A/C 4/78`. Record that last line as the batch exactly as printed; it is
  not decoded.
- Some packets carry no date line — then the contract number is the only lot
  identifier.
- `ITEM: 0001AA` / `0001AB` distinguish contract line items; worth keeping in
  notes, they separate lots of one drawing number.
- Green stickers on the seller's photos are count/price/note tags added by the
  seller or the user, sometimes reused with old values scribbled out — confirm
  odd ones rather than trusting them.
- Brown "kraft" packets may be foil-lined under the paper; do not assume
  either way.
- A source-control or drawing number on a label (Kearfott C528000253,
  Rockwell 351-2274-010, 1989622-1) often covers a commercial part from
  another maker; the NSN cross-reference names it.
- Bourns trimmer part numbers read Model-Style-Product-Resistance
  (`260P1-101`: model 260, P pins, -1 standard, 101 = 100 ohm); "1 YELLOW,
  2 RED (wiper), 3 GREEN" is printed on 1-1/4 in rectangular wirewound
  Trimpots.
- Australian blue `2SD PT&P nnnnn` labels: the number is recorded as batch,
  as printed.
- ADI DSP-era ordering codes: grade J/K = 0-70 C, S/T = -55 to +125 C (T
  faster); package D = side-brazed CDIP, G = PGA, P = PLCC, E = LCC, N =
  plastic DIP; `/883B` = MIL-STD-883 class B. Chips print the code over two
  lines (`ADSP-1010B` / `SD/883B` = ADSP-1010BSD/883B).

## Traps

- Two NSNs with identical FLIS data can still differ by screening (an
  MIL-STD-883 grade vs plain); report it as a same-part question, not a match.
- Parts sharing a seller's bag are not evidence they are the same part
  (HD6755 vs Solitron MS7330 turned out to be different devices).
- An NSN's MCRL may not list a part DLA actually bought under it (DS75160AN
  bags are labelled 5962-01-159-3574, but only DS55160AJ/883 is listed for
  National). The bag label is the evidence.
- A replacement NSN is often a screened/hermetic item or a different spec
  (5962-01-160-8845 is /883; 5905-00-165-3117 is 0.75 W ±5%) — a substitute,
  not the same part.
- NSN Depot can show two NSNs each naming the other as "Replacement NSN" on
  the same date (5962-01-214-9952 / 5962-01-322-4943) — report both.
- Military bags can hold a faster pin-compatible successor the NSN does not
  list (ADSP-1010B under an ADSP-1010A NSN) — a same-part question.
- Micro Networks "H" suffix = −55 to +125 °C grade; plain part = 0 to +70 °C.
  Supply Voltage Min/Max for ±15 V parts records the magnitude of each rail.

## Tooling

- Snapshot tool: `uv run python .claude/skills/source-snapshots/scripts/snapshot.py`
  (see the `source-snapshots` skill). Strip browser-harness's 🐴 title marker
  from saved HTML before `--from-html`.
- Headless Chrome does not exit after `--print-to-pdf`; the tool watches the
  output file and kills the process group — if it hangs, that is why.
- zsh: `set -- $var` does not word-split, so loops building `-o` names from
  a split string give empty URLs — write the commands out explicitly.

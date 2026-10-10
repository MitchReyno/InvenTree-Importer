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
- **cage.report** passes in browser-harness (2026-10-05; earlier runs were
  blocked): `https://cage.report/CAGE/<code>`, save with
  `js("document.documentElement.outerHTML")`, strip the 🐴, snapshot with
  `--from-html`. tedss.com is still behind Cloudflare; stackednsn.com and
  nsnsphere.com CAGE pages show a "Human Verification" wall; NSN Depot
  `/CAGE/<code>` and WBParts `/rfq/cage/<code>.html` return 404. nsnparts.us
  has no CAGE pages — decode a CAGE from any NSN page that lists it.
- NSN Depot's summary "Replacement NSN" can name an NSN this one *replaced*
  (5962-00-115-1839 is the ISC 1 survivor, yet its summary shows
  5962-00-412-0968). Read the ISC table (1 = this NSN is the replacement,
  3 = not authorized) before calling an NSN superseded. A standardization
  replacement can fold commercial-grade NSNs into a military one.
- A pre-1974 FSN (`5905-806-4769`) is the NSN with `00` inserted
  (5905-00-806-4769). FLIS "rotary actuator travel 9000 deg" = 25 turns.
- **parttarget** DLA Land and Maritime range pages (open in browser-harness)
  show whether an SMD has any NSN: a gap in the range means none (2026-10).
- DLA SMD PDFs and the QML-38535 report redirect to the gated
  weaponssupportapps.dla.mil — use maker cross-reference guides instead.

## Data books and datasheets

- **bitsavers.org returns 403 to plain curl, even for PDFs** (2026-10).
  Download through `ftp.mirrorservice.org/sites/www.bitsavers.org/...` and
  keep the canonical `https://bitsavers.org/...` URL as the datasheet link.
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
  - Fairchild 1978 *TTL Data Book*: 9XXX index PDF p. 17; 9000/9001/9020/
    9022 JK flip-flops pp. 522-528; ordering-code key p. 734; outlines
    pp. 735-745 (6A 14-pin p. 737, 6B 16-pin DIP p. 738; OCR reads 6B as
    "68"). `1972_Fairchild_TTL/` is split by chapter: 05.pdf = 9000 series
    (9020 pp. 15-22), 11.pdf = TI cross-reference. The 1971 *TTL Family*
    book has old U-code ordering tables at PDF pp. 109-113.
  - Fairchild 1978 *Full Line Condensed Catalog*: RTL/CTL 900-series table
    PDF p. 261; RTL connection diagrams p. 424; ordering codes pp. 454-455;
    TO-99 outlines p. 483. 1975 edition: RTL family summary p. 223
    (3.6 V +/-10%). No full military RTL (914) data sheet survives on
    bitsavers or archive.org (2026-10).
  - Fairchild 1977 *CMOS Data Book*: "Unique 38510" order suffix
    (QB = class B, QC, QS) at PDF pp. 399-401.
  - Motorola 1969 *microElectronics* is split into chapter PDFs under
    `components/motorola/_dataBooks/1969_Motorola_microElectronics/`;
    `15_MRTL_900.pdf`: functions p. 3, ratings p. 4, outlines p. 5, MC914
    pp. 31-32. No text layer — archive.org item
    `bitsavers_motoroladamicroElectronics15MRTL900_3260682` has OCR.
  - ADI 1973 / 1975 *Product Guides* (`components/analogDevices/_dataBooks/`)
    cover the early discrete/hybrid op-amp modules. 1975: model 118/119 at
    PDF p. 36 (printed + 2), open-loop curves p. 68, M-package outlines and
    pinouts p. 249 (printed 247). 1973: 118 at PDF p. 40, outlines p. 194.
    The 1975 guide is **196 MB**: too big for the InvenTree server to accept
    (uploads time out), so only its page extract attaches under
    `--mirror-datasheets`; the whole book stays a link. (2026-10)
    The June 1972 *A-D Conversion Handbook* PDF pp. 311-312 is only an op-amp
    selection table. The 1980 *Data Acquisition Catalog* PDF p. 9 lists
    module families "not catalogued here (but still available)".
  - AMD 1974 Data Book / 1979 Designer's Guide / 1981 Condensed Catalog:
    AMD second-sourced Fairchild 93xx/96xx only, no 9000-series.
  - sr-ix.com keeps per-device index pages of 1960s sheet scans
    (`/Archive/solid-state-datasheets/Indices/<n>.html`).
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
- **Harris SMD → part:** Harris *1997 Cross-Reference Guide* (bitsavers,
  40 MB): PDF pp. ~200-225 by SMD, ~250-262 by /883 part, with the Intersil
  file number (3699 = FN3699). 1990/1992 *Product Selection Guides* hi-rel
  tables list SMDs too (1990 p.207 amps; 1992 pp.263-268); 1992 p.257 gives
  SMD/JAN nomenclature (lead finish A = solder dip, C = gold). (2026-10)
- **National 1988 FAST data book** (`1988_400024_…`): 54F/74F08 PDF pp.78-80;
  ordering key p.694 (74F comm / 54F mil; P plastic DIP, D ceramic DIP,
  F flatpak, L LCC, S SOIC; C = 0/+70, M = -55/+125); 14-lead CDIP outline p.698.
- **ST LS1240/LS1240A** datasheet is gone from st.com (404); static.chipdip.ru
  has the July 1998 sheet. st.com hangs on curl but works via browser-harness
  `fetch`. (2026-10)

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
- 67268 DLA Land and Maritime (SMD 5962-xxxxx numbers); 16236 DLA Land and
  Maritime (DMS8xxxx DESC drawings)
- 24355 Analog Devices (Wilmington MA; module-era NSNs); 89661 Westinghouse
  Electric Surface Div, Baltimore (cancelled -> 97942 Northrop Grumman;
  128Cxxx Hnn drawings); 13919 Burr-Brown; 51870 Cooper Laboratories, Wayne NJ
  (obsolete); 30003 NAVAIR (247AS-Cnnnn drawings)
- 34148 Fairchild Camera and Instrument Corp (sub of Schlumberger), Mountain
  View; obsolete code, on 1980s DLA bags for Fairchild mil order codes
  (914HMQB, 9020DMQB, 9304FMQC). 13715 Fairchild Components Group.
- 05869 Raytheon Company (725000-xxx / 725004-xxx drawings); 90536 Lockheed
  Martin; 3V146 Rochester Electronics; K7093 National Semiconductor UK;
  26512 / 97942 / 06481 Northrop Grumman; 93322 GE Aviation Systems;
  34335 AMD; 19200 US Army ARDEC; 9009H Polish armed-forces inspectorate
  (5962PL… numbers)
- 07243 is BAE Systems Norfolk Ship Repair — a "07243" on a chip lid is not
  a maker code.
- 27318 Stewart-Warner Corp Microcircuits Div; 98738 Herley Chicago dba
  Stewart Warner Electronics. SWnnn-xP numbers are DTL second-sources
  (SW945-1P = 945, SW941-1P = 941, SW751/SW751-2P = 951, SW7402N = 7402).
  No Stewart-Warner catalogue is online.

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
- Fairchild order codes: number + package (D ceramic DIP, F flatpak, H
  TO-5-type can incl. TO-99, P plastic) + temperature (C commercial, M
  -55/+125 C) + optional QB/QC/QS ("Unique 38510" screening class). Old
  9-digit codes read U + package (7B, 4L, 5B, 6A) + device + 51X (military)
  / 59X (industrial), e.g. U7B902051X = 9020 military DIP; 99xx numbers and
  U-codes are industrial grades (0-70 C), not the military 9xx part.
  Fairchild HL-numbers are house numbers: chip `F HL121310 / 9020 / 8427 J`,
  bag `HL1213109020`.
- Motorola MRTL: MC9xx = -55/+125 C, MC8xx = 0/+100 C; G = TO-99 can,
  F = flatpak.
- Drawing-controlled chips can carry the prime's drawing number on the
  ceramic beside the lid (`72500` / `0-315`) while the lid carries the real
  maker's logo (an AMD chip under Raytheon 725000-315).
- Unknown logo on a chip: use `reference/chip-manufacturer-logos/` (483 logos
  marked on chips, 1990s-2000s; see its README). Grep `index.csv` for any text
  or shape in the mark; for symbol-only marks, crop the photo to the logo and
  run `python3 -I reference/chip-manufacturer-logos/match.py crop.png --sheet
  out.png`, then confirm on the candidate sheet. `pages/` holds agent-sized
  grids grouped by shape. No newer makers — no close match means not covered,
  not the nearest candidate.
- ADI module-era grades A/K/L are not the later J/K/S: for the 118, A =
  -25/+85 C with higher drift, K = 0/+70 C with lower drift. ADI 4-digit
  numbers on bags and module sides (5716 = 118A, 5966 = 118K) sit in MCRLs
  under 24355 beside the model; probably customer-specific specials.
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
- Harris rounded-square "H" logo appears on both CD4000B chips (CD4073BF)
  and Harris SMD parts — the maker is Harris Semiconductor.
- SMD marking `5962 C <drawing><case><finish>`: "C" is the non-JAN
  MIL-PRF-38535 app. A compliance indicator (Q/QML on QML-flow parts; seen
  only in search excerpts of SMD §3.5.1). Harris lot lines like `H0C9217` /
  `HOC9050` remain undecoded.

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
- An NSN MCRL can list a commercial-grade code (9020DCQC) on a -55/+125 C
  NSN — do not read the grade off the MCRL.
- 5962-00-329-5937 / 5962-01-060-0001 (9020) also name each other as
  replacements; plain 9020DM is only on the second.
- ADI "model 118" (discrete potted module, ca. 1970) is unrelated to the
  monolithic LM118 / LT118A / RH118; web searches for "118A" find only those.
- FLIS can call a discrete potted module "MONOLITHIC" and its two-edge pin
  layout "DUAL-IN-LINE" — trust the maker's catalogue.
- Micro Networks "H" suffix = −55 to +125 °C grade; plain part = 0 to +70 °C.
  Supply Voltage Min/Max for ±15 V parts records the magnitude of each rail.
- SW751-1P sits on the 941 NSN (5962-00-234-1221, Herley advisory ref)
  while SW751/SW751-2P sit on the 951 NSN (5962-00-461-5182) — the suffix
  may change the family; ask, don't pick.

## Tooling

- Snapshot tool: `uv run python .claude/skills/source-snapshots/scripts/snapshot.py`
  (see the `source-snapshots` skill). Strip browser-harness's 🐴 title marker
  from saved HTML before `--from-html`.
- Headless Chrome does not exit after `--print-to-pdf`; the tool watches the
  output file and kills the process group — if it hangs, that is why.
- zsh: `set -- $var` does not word-split, so loops building `-o` names from
  a split string give empty URLs — write the commands out explicitly.
- **alldatasheet PDF download:** POST the download-page form (inputs `innum`,
  `tmpinfo1aa`) with `fetch` inside browser-harness and base64 the response
  to get the real PDF. (2026-10)
- **Bing in browser-harness** works as a search engine (read `li.b_algo h2`;
  target URL is base64 in the `u=a1…` link parameter) and finds NSN pages
  WebSearch misses; DuckDuckGo HTML returns nothing to curl. static6.arrow.com
  and datasheet.ciiva.com time out from curl. (2026-10)

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
  been superseded. Large snapshot (~3.5 MB). (2026-10) Since 2026-10-12
  `curl` returns the MCRL and ISC tables but **not** the Seg M/V
  characteristics (JavaScript-built): render in browser-harness, save
  `outerHTML`, snapshot with `--from-html`.
- **resistors.tpub.com/<page>/<NIIN>.htm** — static, `curl` OK: old FLIS
  records (00-series NSNs) with values and every reference number; finds the
  original NSN of a number later moved as RNCC E. (2026-10)
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
- For resistor networks NSN Depot lists every FLIS resistance value with its
  identical-value quantity; nsnparts.us garbled the same record (DIP shown as
  "TERMINALS ONE END"). (2026-10) The values and the LOWEST / Nth
  INTERMEDIATE / HIGHEST quantities are separate lists: pair them by sorting
  the values ascending and matching rank, and say the pairing is inferred.
  FLIS gives only derating points (full power at 25 °C, 0 at 125 °C), not an
  operating range — leave Operating Temp unset.
- When a part-number search finds nothing, scan neighbouring NIINs: parallel
  `curl` of `nsnparts.us/parts/nsn/<NSN>.html` for ±30 around a sibling's
  NSN, then `grep -l` the part number. Sibling custom parts often got
  consecutive NIINs on one date. The `/search?q=` pages of nsnparts.us and
  NSN Depot return nothing useful to `curl`. (2026-10)

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
  the import's `datasheets/` folder (`.local_imports/<import id>/datasheets/`)
  and attach the local file instead of linking.
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
- **Commercial logic data books on bitsavers (PDF page = this device):**
  Motorola 1988 *CMOS Logic Data*: B-series gates pp.36-41, MC14049UB/50B
  pp.156-159, MC14043B/44B p.147-; outlines Case 632 p.551, 620 p.553.
  Motorola 1989 DL121r4 *FAST and LS TTL*: LS04 p.343, LS05 p.344; Case 646
  p.701. Signetics 1987 *TTL Data Manual*: LS74A pp.158-162; DIP marking key
  p.900; DIP-14 outline p.905. National 1987 *LS/S TTL*: LS08 pp.98-99, LS32
  pp.121-122, LS74A pp.135-137, LS244 pp.269-271; N14A p.842, N16A/N18A
  p.843, N20A/N24A p.844 (no date-code key). National 1988 *Interface*:
  DS3691 p.102-, DS1692/3692 pp.108-112; N16A p.994. TI 1986 *ALS/AS* (60 MB):
  ALS244A pp.316-318; N outlines pp.1213-1215. Philips 1986 *IC04 HE4000B*:
  marking key p.27, family ratings pp.96-99, HEF4016B pp.182-188. SGS-Thomson
  1991 *COS/MOS B-Series* (35 MB): 4043B/4044B pp.272-279 — first mirror
  download was truncated, check `pdfinfo`. Fairchild 1977 *CMOS Data Book*:
  ratings p.52, 4044B pp.137-140, ordering key p.396, 16-pin CDIP p.404.
  (2026-10)
- `assets.nexperia.com/documents/data-sheet/<type>.pdf` and TI
  `/lit/ds/symlink/` work with curl; onsemi `/download/data-sheet/pdf/` 403s.
- **TE / AMP** (2026-10): te.com 403s curl; use browser-harness. An obsolete
  or superseded PN can show "page unavailable" while its successor
  (`5-533009-8`) has a page. Customer drawings: `fetch()` inside a te.com tab
  on `/commerce/DocumentDelivery/DDEController?Action=srchrtrv&DocNm=<base>&DocType=Customer%20Drawing&DocLang=English&DocFormat=pdf`,
  base64 it out. Drawings have no text layer — `pdftoppm` and read the
  dash-number table ("SUPERSEDED BY", "OBSOLETE"). Catalogue-section fetches
  fail (cross-origin). First `js(outerHTML)` can time out; retry.
- **Elec-Trol** reed relays: no catalogue online. A Digi-Key Hamlin DIP page
  with an Elec-Trol cross-reference column is mirrored at
  uglyduck.vajn.icu/PDF/relay/RA30441051.pdf: series sets form/diode, then
  `105x/112x/124x` = 5/12/24 V coil. Sibling NSNs on nsnparts.us carry the
  FLIS contact data (RA3038-1051 5945-01-011-3291, RA3038-2051
  5945-01-123-9872). Elec-Trol (Saugus CA) -> Hamlin -> Littelfuse (2013).
  The chart maps RA3045/RA3046 x 1051/1121/1241 to Hamlin HE721A0500/1200/
  2400 and HE721A0510/1210/2410 (RA3046 = with diode). Littelfuse's HE700 PDF
  403/404s; mirror: static.chipdip.ru/lib/234/DOC011234270.pdf (rev 10/2015).
- **Sprague catalogues** on bitsavers (`components/sprague/`; bitsavers 403s
  curl, use `ftp.mirrorservice.org/sites/www.bitsavers.org/...`): *Electronic
  Components* 1980 (30 MB) DIP Monolythic 923C pp. 5, Z5U table p. 9;
  *C-567B Passive Components* 1985 (68 MB) Series 920C p. 4, 1C-5C Monolythic
  ~pp. 83-85, 292C/592C pp. 92-93. Extract pages with pypdf; too big to
  attach whole. 92xC key: 3rd digit = pins (3=2, 5=4, 9=8, 4=14, 6=16),
  dielectric, pF code, tolerance (J/K/M/Z), voltage (050/100/200), size code
  B/D/F = body height 0.135/0.165/0.250 in. (2026-10)
- **Bourns** datasheets `bourns.com/docs/Product-Datasheets/<series>.pdf` work
  with curl; product pages 403 curl and snapshot at ~16 MB (link only).
  4300R marking: part number / resistance code / logo + CYYWW (C = country).
- **Digi-Key** product pages work in browser-harness (retry the first load);
  snapshot ~2.4 MB via `--from-html`. A keyword search hitting one exact MPN
  redirects straight to the detail page — do not then click the first
  `a[href*=MPN]`, which can be the login redirect. The snapshot banner reads
  "HTTP status 403" (the tool's own re-fetch is refused); that is normal, grep
  the file for the attributes used. Mouser pages render blank; Future and
  Farnell 403 `curl`. (2026-10)
- **Vishay Dale MDP** networks: `vishay.com/docs/31511/31511.pdf` (curl OK).
  Code MDP + pins + schematic (01 bussed, 03 isolated, 05 dual terminator) +
  3-digit value + tolerance (G ±2%, J ±5%). Power is rated at +70 °C.
- **Bourns RC-1A Resistive Components, Sep 1989** (bitsavers
  `components/bourns/`, 27 MB, 208 pp; download via
  ftp.mirrorservice.org/sites/www.bitsavers.org/…): 4100R molded DIPs at PDF
  pp. 55-56 (printed 54-55, ordering-key example 4114R-001-152); M83401
  cross-reference p. 182; model index p. 8. Old circuit codes -001/-002/-003
  = isolated/bussed/dual terminator (current sheets write -1/-2/-3); 1980s
  bodies carry a 4-digit YYWW under the logo. Extract saved as
  `datasheets/bourns-rc1a-1989-4100r-pp55-56.pdf`.
- **KYOCERA AVX leaded MLCC catalogue** `catalogs.kyocera-avx.com/MultilayerLeaded.pdf`
  (87 pp, curl OK; PDF page = printed + 3): dielectric specs (Z5U p. 16),
  aging p. 9, DIPGuard MD 2-pin DIP pp. 40-41. Per-series sheets
  (`datasheets.kyocera-avx.com/dipguard.pdf`) omit the temperature range.
  kyocera-avx.com product pages snapshot at ~16 MB — link only.
- **AVX DIPGuard MD** top marking: A + voltage (Y 16 V, 5 50 V, 1 100 V) +
  dielectric (A C0G, C X7R, E Z5U) + pF code + tolerance, e.g. A5E104M =
  MD015E104M_ (style MD01/02/03 and the last assembly letter A/B are not
  marked; current codes end -MAB). 200 per slide pack. Body colour varies
  (brown, mustard) within one maker.
- No catalogue online for Quality Components Inc (Ridgway PA) or Stackpole
  GA ceramics (WebSearch, Bing, archive.org; 2026-10); search engines confuse
  it with Quality Components of Syracuse NY, a rep firm.

## CAGE / FSCM codes seen

- 04713 Motorola (now listed as Freescale/NXP)
- 07263 Fairchild Semiconductor
- 01295 Texas Instruments
- 12115 DRS ICAS (design-control numbers like SC5962-…)
- 13499 Rockwell Collins Government Systems (351-xxxx-010 house numbers)
  — also 350-xxxx-010 and 263-xxxx-0x0 (connectors); A-B chips made for
  Collins print the Collins number under the A-B type.
  350-4004-0x0 dash numbers are distinct A-B film networks, not grades:
  -010 = CDD816 / BI 1898-279-0 / NSN 5905-01-134-1211; -020 = CDD817 /
  BI 1898-280-1 / NSN 5905-01-134-1212. The A-B numbers carry RNVC 9 "no
  longer used"; the Collins number is the design-control one.
- 15636 Elec-Trol Inc; 12617 Hamlin Inc; 56289 Sprague Electric Co;
  95105 Rockwell Collins Inc (350-4001-450 = Bourns 4310R-101-102); 32997
  Bourns Inc; 4J937 Bourns Networks; K5743 Bourns Ltd; 28454 Electrol
  Specialties Co (not Elec-Trol); 73138 BI Technologies (Beckman);
  00779 AMP (on drawings); 21424 Relay Specialties; 07126 Digitran;
  14922 Nicolet Scientific; 50621 Wavetek Rockland; 95348 Gordos Arkansas;
  78277 Sigma Instruments; 06163 EAC Industries
- 14433 ITT Semiconductors
- 95121 Quality Components Inc, Ridgway PA (QC-prefixed axial ceramics;
  other "Quality Components Inc" CAGEs 5S208, 1K2F9, 1CS33, 5R242 are
  unrelated distributors); 78488 Stackpole Corp (GA/GVA ceramics); 78429
  Carbon/Graphite Group; 59474 Jeffers Electronics; 80063 US Army CECOM
  (SM-C-nnnnnn drawings); 37695 Raytheon; 72314 BAE Systems IESI
- 91637 Vishay Dale Electronics; 24546 Dale Electronics (old); F5491
  Rockwell Collins France; 94756 Boeing; 64537 Aeroflex Control Components
- Collins 350-4027-0x0 = 14-pin isolated networks (-030 = 680 ohm x7 ±2%,
  Bourns 4114R-001-681, NSN 5905-01-274-1221); 350-4030-0x0 = 16-pin bussed
  (-010 = 220k ±5% MDP16-01 224J, NSN 5905-01-138-1902; -020 = 4.7k; -110 =
  22k). 351-5600-010 = 54F00 (NSN 5962-01-173-7737)
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

- MacService "MATERIAL IDENTIFICATION TAG" (C.P.N. / G.R.S. / RESERVED FOR /
  QTY): C.P.N. is most likely the Collins part number (inferred, 2026-10).
  G.R.S. and the 974-M000-0x0 numbers are undecoded; tag QTYs are often stale.
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
- MCRL capacitor spellings: UUF = µµF = pF; PORM nPCT / P0RM = ±n%
  (QC-2.2PFPORM5PCT = QC2.2PF ±5%). FLIS preservation method 41 = sealed
  water-vapour-proof bag (the foil-lined DLA packets).
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
- Unknown logo on a chip: load the `chip-logo-identification` skill (483
  logos marked on chips, 1990s-2000s). Grep its `data/index.csv` for any text
  or shape in the mark; for symbol-only marks, crop the photo to the logo and
  run its `scripts/match.py`, then confirm on the candidate sheet and the
  shape-grouped pages. No newer makers — no close match means not covered,
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
- **Order-code temperature letters differ by family:** Fairchild CMOS
  `C` = -40/+85 C (not 0-70 as in Fairchild TTL), `M` = -55/+125, D/P/F =
  ceramic/plastic/flatpak. Motorola CMOS BAL = -55/+125 ceramic, BCP/BCL =
  -40/+85 plastic/ceramic, UB = unbuffered. SGS HCF = -40/+85, 3-15 V; HCC =
  -55/+125; order code `…BEY` prints `…BE`. Philips HEx: F = -40/+85, P =
  plastic; line 2 = factory id (e.g. HSS) + date + layout no. Signetics
  `N74LS74AN` prints `74LS74AN`; date YYWW, plant V = SigThais (Thailand).
- TI `-1` suffix on SN74ALS244A-type bus drivers = IOL raised to 48 mA, only
  at VCC 4.75-5.25 V; no 54-series -1.
- DS3692 is the MIL-STD-188-114 version of the DS3691 (the RS-422/423 one).

## Traps

- A ±5% and a ±2% version of one network sit on different NSNs
  (5905-01-138-1902 vs -200-3923). Check the tolerance letter before tying a
  Collins number to a lot.
- FLIS power on networks uses different reference temperatures (3.000 W at
  25 °C vs 1.500 W at 70 °C); maker sheets rate at 70 °C. Always say which.
- Reused tubes carry labels for unrelated items (a 54F00 label on a resistor
  network tube). Decode every number on a tube before trusting it.
- A `spec` capacitor can key-match an existing part from another maker (AVX
  MD015E103MAB and Sprague 923CZ5U103M050B, both 0.01 uF ±20% 50 V 2-DIP)
  while their temperature ranges differ; raise it as a same-part question.
- 5910 capacitor NSNs from 1960s item reduction can be ISC 1 survivors that
  absorbed NSNs of other tolerances; their part numbers are not this part.
- FLIS capacitor records give % change over temperature, not a dielectric
  class or ppm/K — leave Dielectric Material and Temperature Coefficient unset.

- Allen-Bradley's body font prints D so it reads as 0: CDD817 looks like
  C00817. Read A-B lot codes (8C13H, 8D14M) with the same caution.

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
- The server's MC14044B (IC-00059) stores -55/+125 C but its MPN
  MC14044BCL is C series (-40/+85) — check a server record's temperature
  against the MPN before treating it as a match.
- Count socket/header positions on the full-resolution photo (grid overlay or
  pins per row): briefs got 3 of 4 connector counts wrong (2026-10).
- AMP prefixes change the part within one drawing: 533009-8 = 50 pos,
  1-533009-8 = 120 pos, 5-533009-8 = RoHS successor of -8.
- TE obsolete pages keep the internal description, so sibling dash numbers
  decode a drawing (AMP-LATCH 746182-1/-2/-3/-4 = 10/14/16/20 pos). The
  DDEController fetch returns HTTP 500 when no customer drawing exists.
- A "radial" ceramic in a brief can be a 2-pin DIP-format Sprague 923C; Z5U is
  a dielectric class, so it goes in `Dielectric Material`, not the ppm/K
  `Temperature Coefficient`.
- An NSN's replacement can be a different variant (RA30461051 with diode ->
  RA30461051-02 with shield) or a MIL substitute with other ratings.
- eBay item pages are logged in (name, user id, postcode in the HTML; 216 MB
  snapshot): link only, never snapshot. Images curl from
  `i.ebayimg.com/images/g/<id>/s-l1600.jpg`; a seller photo of the maker's
  tube label can prove the part number. Octopart: captcha, dead end.
- Elec-Trol's pole digit (RA3038-1xxx vs -2xxx) is not universal: RA3098-1121
  and RA3123-1241 are 2 Form A. Don't decode form from it outside a series.
- Dead ends: eBay item pages and lintechcomponents.com 403 curl; Datasheet
  Archive lists only stock for Elec-Trol; archive.org free-text maker search
  is noise — use `title:(...)`.

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
- **Google in browser-harness** works for exact part-number searches
  (`a h3` → closest `a`); Bing ignores quotes on part numbers. (2026-10)
- **Bing in browser-harness** works as a search engine (read `li.b_algo h2`;
  target URL is base64 in the `u=a1…` link parameter) and finds NSN pages
  WebSearch misses; DuckDuckGo HTML returns nothing to curl. static6.arrow.com
  and datasheet.ciiva.com time out from curl. (2026-10)
- Server: DIP IC sockets live in `Connectors/Pin Sockets` (`Connector Type`
  like `DIP, 0.6" (15.24mm) Row Spacing`, grid `24 (2 x 12)`, pitch in mm
  with the unit written); female strips in `Connectors/Rectangular
  Connectors`. Read part parameters with
  `GET /api/parameter/?model_type=part.part&model_id=<pk>` (`/api/part/parameter/` 404s).
- zsh: never name a shell variable `path` (it clobbers PATH).

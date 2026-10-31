# Component research guide

A compact reference for methods useful across unrelated component research
sessions. Read it before researching; it is guidance, not evidence for a part.

## Keeping this guide useful

Leave this file unchanged during routine imports. Update it only when a
finding establishes a reusable research shortcut, useful source or recurring
interpretation trap, or corrects existing guidance. It should be likely to
help future sessions beyond the item being researched. Concrete source URLs,
lookup patterns and brief examples are welcome when they save repeated work.
Merge them into an existing section and remove superseded advice.

Keep part numbers, CAGE/company mappings, decoded suffixes, catalogue page
locations, lot details, search histories and temporary site failures out of
this guide. Preserve those in the import's research report, record notes and
provenance, with supporting snapshots and datasheet extracts under
`.local_imports/<import id>/`. Pass useful findings to other researchers in
that import through their briefs. Do not accumulate dated session appendices
or move them into another shared research log.

## Source directory and lookup techniques

These are starting points retained from earlier research, not a live site-access
status list. Check the returned content; access methods and coverage can change.

### NSN, FLIS and CAGE records

- **NSN Parts:** `https://nsnparts.us/parts/nsn/<13-digit NSN>.html`.
  Useful for reference numbers, CAGE/company names, assignment dates and FLIS
  characteristics. A page saying "could not find the INC xml file" is a stub,
  not evidence that the part or NSN does not exist.
- **NSN Depot:** `https://www.nsndepot.com/NSN/<dashed NSN>`.
  Look for the MCRL (part-number cross-references), RNCC/RNVC qualifiers and
  ISC/replacement history. Characteristics may need browser rendering even
  when a plain fetch returns the reference tables.
- **ISO Group:** `https://www.iso-group.com/NSN/<dashed NSN>`.
  Worth checking for cancelled records and characteristics omitted elsewhere.
  **WBParts** and **PartTarget** are additional cross-reference leads when
  the first sources are incomplete.
- **CAGE lookup:** `https://cage.report/CAGE/<code>`, or an NSN record listing
  the code. Check the company location and historical name as well as its
  current name; acquisitions and reused names can obscure the original maker.
- **Older records:** `resistors.tpub.com` has historical FLIS listings;
  equipment manuals and parts lists can connect drawing numbers to old stock
  numbers. Search the exact MPN independently of the NSN printed on the bag.
- For an old US FSN, try the modern NSN form with `00` between the four-digit
  FSC and seven-digit item number. Search both forms; the FSC may also have
  changed. An FSC plus a part number is not automatically an NSN.
- If one digit is obscured, compare the plausible candidates against the MPN,
  item description and markings. If a related record exists, nearby NIINs
  can provide leads, but proximity does not establish identity. A stub or
  missing record alone does not rule out a candidate.
- Follow both the original and replacement records. A replacement summary
  can describe an NSN absorbed by this record rather than its successor;
  resolve direction from the history and qualifiers. Report ambiguity.
- A lookup site can silently display a replacement's MCRL or characteristics
  for a cancelled NSN. Confirm which record the displayed data belongs to
  before attributing it to the requested item.
- DLA/WebFLIS and military-document services may be gated. Follow the research
  agent's consent-banner rule; use a plain link and seek accessible maker
  cross-references or copies rather than clicking through.

### Vintage data books, standards and cross-references

- **Bitsavers:** browse `https://bitsavers.org/components/<maker>/` and its
  `_dataBooks/` directory where present. The mirror at
  `https://ftp.mirrorservice.org/sites/www.bitsavers.org/` provides an alternate
  download route. Keep the canonical document URL alongside a mirrored file.
  Some makers organise books by family or chapter instead of `_dataBooks/`.
- **Internet Archive:** search by maker, title and year; `title:(...)` helps
  narrow noisy maker-name results. Advanced search is available at
  `https://archive.org/advancedsearch.php`; item files can include `_djvu.txt`
  OCR even when the PDF has no text layer. `manuallib-id-*` items are another
  source of scanned manufacturer sheets.
- **Datasheet Archive and alldatasheet:** useful for obsolete sheets and
  shortform catalogue scans. Distinguish an actual document from a stock-only
  listing. Follow the stock-import skill's existing alldatasheet browser-script
  instructions; keep expiring download URLs out of permanent datasheet links.
- **Military types:** MIL-M-38510 slash sheets and Standard Microcircuit
  Drawings can establish device, grade, case and finish. Maker high-reliability
  selection guides and SMD/JAN cross-reference books can map these numbers
  back to commercial families. Check manufacturers' designation tables as well
  as the electrical tables.
- **UK CV types:** the Blunham CV Register and scanned Ministry of Defence CV
  specifications are useful for prototype numbers and NSN cross-references.
  The register is an identity lead; use the specification for ratings.
- **Equipment house numbers:** service manuals, replacement-parts lists and
  manufacturer cross-reference guides can be more useful than a generic
  datasheet search. TekWiki's replacement-parts documents are one example.
  A selected or programmed device may need evidence beyond the base type.
- Prefer period ordering guides when modern successor sheets omit an old
  package or screening grade. Search broader product guides and condensed
  catalogues when there is no standalone sheet; identify selection-table
  evidence as such rather than calling it a full datasheet.

## Finding and reading documentation

- Start with manufacturer documentation for the exact type and suffix. For
  obsolete parts, use period data books, ordering guides, military slash
  sheets and cross-reference manuals. Bitsavers and Internet Archive are
  useful starting points; check mirrors when the canonical source is unavailable.
- Search scanned books by part number and likely OCR variants. Check the
  actual page image: OCR commonly confuses letters, digits, units and symbols.
  Use OCR or rendered pages when the PDF has no usable text layer.
- Record 1-based PDF page numbers for `datasheet_pages`, not printed page
  numbers. Include separate ordering-code and package-outline pages when
  needed. Verify the downloaded PDF and extract relevant pages from large books.
- For searchable books, use `pdftotext -layout` and search the type and OCR
  variants (`0/O`, `1/I/l`, `5/S`, `µ/u`). Restrict extraction with `-f` and
  `-l` to inspect likely pages, then read the rendered table and footnotes.
  An OCR hit in an index or cross-reference is only a lead to the device page.
- `datasheet_pages` accepts separate ranges and pages, for example
  `"12-16, 48"` for the device sheet plus its package outline. Check each
  edition's offsets; do not reuse printed-to-PDF offsets from another scan.
- Check downloads with `pdfinfo` before extracting pages. A truncated download
  or HTML error page can look like a successful fetch. Keep the full book as
  a reference link and attach the relevant extract when the book is too large.
- Download signed or expiring PDF links into the import's `datasheets/`
  folder rather than storing an unusable link. Keep read-only scratch downloads
  under `.temp/<import id>/research/`.

## Interpreting identity and cross-references

- An unsuccessful search, missing catalogue entry or stub page establishes a
  research gap, not proof that a type does not exist. Report where you looked
  and what remains unresolved rather than substituting a similar number.
- Preserve cross-reference qualifiers: "direct replacement", "similar
  replacement", and incomplete or obsolete reference numbers carry different
  weight. Use them as qualified evidence rather than treating every listed
  number as an exact equivalent.
- Search both the package markings and the label identifiers. A drawing or
  house number can refer to another maker's commercial part; packaging may
  have been reused. Report conflicts rather than choosing an identity silently.
- NSN/FLIS listings help establish cross-references, but a shared or replacement
  NSN does not prove identical grade, screening, package or ratings. Read the
  reference qualifiers and replacement history, not just the site's summary.
  NSN Parts, NSN Depot and ISO Group are possible starting points; verify the
  actual record and distinguish it from a stub or replacement's record.
- A CAGE/FSCM can identify design control, a distributor or a successor company
  rather than the original manufacturer. Corroborate it with markings and
  period documentation. Use the `chip-logo-identification` skill for an
  unfamiliar maker's mark; a near match is not identification.
- Decode suffixes and date codes from the relevant maker, family and era's
  documentation. Conventions can change between product families: Fairchild's
  C temperature grade differed between TTL and CMOS. Verify the applicable
  ordering table and keep undecoded markings verbatim.

## Markings, packaging and recurring identity traps

- Keep label fields distinct: NSN, CAGE/FSCM, maker's part number, contract,
  contract line item and batch/date markings serve different purposes. Keep
  an undecoded date-like line verbatim; a procurement date is not necessarily
  the device manufacturing date.
- Reconcile the device marking with the bag or tube. Seller tags and reused
  packaging can carry stale quantities or another part's identity. Multiple
  devices sharing a bag are not evidence they are the same part.
- A part number can wrap across marking lines. Preserve suffixes, prefixes
  and dash numbers until an ordering table establishes their role; they can
  change the device, pin count, grade or screening rather than just packaging.
- A marking fragment can combine a partial type and a quantity. For example,
  "AAZ" above "3" might be a partial type plus a count, not the device number
  AAZ3; preserve the layout and seek corroboration before combining the text.
- A maker's logo, an ESD symbol, a JAN designating symbol and a generic type
  marking are different clues. A catalogue establishes who offered a type,
  but does not by itself identify the maker of a worn or rebagged specimen.
- Identical FLIS characteristics or a shared NSN can conceal different
  tolerances, temperature grades, screening or hermetic packages. Replacement
  history may consolidate commercial and military variants. Treat merging
  inventory records as a same-part question for the caller and user.
- FLIS descriptions and package names can be broad or wrong. Compare the
  package outline and pin arrangement to the photo; count connector positions
  on the full-resolution image rather than relying on the brief.
- Blank and programmed memories, and selected versions of standard devices,
  may share a base type while differing in function or acceptance criteria.
  Flag drawing-controlled versions rather than assuming an ordinary blank part.

## Comparing specifications and preserving evidence

- Distinguish absolute maxima, operating limits, typical values and test
  conditions. Keep temperature, bias, load and derating conditions with the
  rating. A test current is not a current rating; a derating endpoint is not
  an operating-temperature limit.
- Treat substitutes as leads, not sources for the original part's ratings.
  Report conflicting sources with their attribution; leave unresolved
  parameters unset and mark decoded or carried-over facts as inferences.
- Read table footnotes and column headings together. Forward-voltage test
  current, minimum breakdown voltage and maximum working voltage are distinct.
  Likewise, power at a stated lead temperature differs from free-air power.
- FLIS temperature-change percentages do not directly establish a dielectric
  class or a coefficient in ppm/K. Repeated network values and quantities may
  need interpretation; mark inferred pairings explicitly instead of presenting
  a flattened table as a direct reading.
- Manufacturer and FLIS data can disagree. Preserve both with the relevant
  conditions; do not combine the most convenient figures into a synthetic spec.
  Check an existing inventory record against its exact MPN before reusing it.
- Follow `source-snapshots` for evidence capture and `browser-harness` for
  pages requiring a browser. Verify each snapshot contains the facts used.
  Site access can change; keep session-specific workarounds in the report.
- When a browser-rendered page contains the evidence but a plain fetch does
  not, save its rendered HTML and use the snapshot tool's `--from-html` mode.
  Check the saved facts rather than relying only on an HTTP status or title.
  Avoid capturing account details from logged-in marketplace pages; retain a
  source link when a clean evidence snapshot is not available.
- Use separate `BU_NAME` sessions for parallel browser-harness researchers,
  or explicitly create and select each researcher's tab on every call. Confirm
  page identity before downloads or snapshots; a shared daemon can otherwise
  save another researcher's page.

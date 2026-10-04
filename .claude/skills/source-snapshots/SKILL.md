---
name: source-snapshots
description: Capture web pages used as sources (NSN/CAGE listings, distributor and manufacturer product pages, forum posts, cross-references) as self-contained static HTML files - or PDFs - with a banner recording when and from where they were taken, so the evidence survives after the page changes or disappears. Use whenever a part's details come from a web page that should be kept with the record, e.g. as an attachment in an InvenTree stock import.
---

# Source snapshots

Web pages move, change and disappear: cancelled NSNs lose their
cross-references, distributors delist parts, datasheet mirrors come and go. A
part recorded from a page that no longer exists has no evidence behind it. A
snapshot keeps the page as it was, as one file that opens offline in any
browser and can be attached to the record.

## The tool

Run from the repo root (`requests` comes from the project environment):

```bash
S=.claude/skills/source-snapshots/scripts/snapshot.py
uv run python $S "<url>" -o .local_imports/snapshots/<import id>/l03-nsn-5961007827187.html
uv run python $S "<url>" --render                 # run the page's JavaScript first (headless Chrome)
uv run python $S "<url>" --from-html saved.html   # markup saved from a real browser
uv run python $S "<url>" --pdf                    # also print the snapshot to PDF
```

Without `-o` the file goes to `.local_imports/snapshots/` (or `--dir`) under a
name built from the host and capture time.

What it produces: stylesheets (with their `@import`s), images, fonts and
favicons are inlined as data URIs; lazy-loaded and `srcset` images are
resolved. Scripts, frames, event handlers and meta refreshes are removed, and
`<noscript>` content is kept. Links still point at the live site. A banner at
the top records the capture time (local and UTC), the URL as requested and
after redirects, the page title, HTTP status, content type, the server's
Last-Modified and Date, how the page was obtained, and anything that could not
be fetched; the same facts are in `snapshot:*` meta tags. Resources over 5 MB,
or past 30 MB in total, are left out and listed. The command prints the banner
rows, so you can check the capture without opening the file.

`--render` and `--pdf` need Chrome or Chromium, found automatically or set
with `INVIMPORT_CHROME`. The script can also be imported (`take_snapshot`,
`write_snapshot`, `print_pdf`); see its docstring.

## Rules

- **Snapshot only pages you actually used.** A search-results page is not a
  source. Several lines (or several parts) relying on one page can share one
  snapshot.
- **Check what you captured.** A page built by JavaScript comes back from a
  plain fetch as an empty shell: read the banner's title and look at the body
  (grep the file for the facts you relied on). If they are missing, retry with
  `--render`.
- **Bot-protected or consent-gated pages.** Open the page with
  browser-harness, save its HTML, and pass it with `--from-html saved.html`;
  the URL is still recorded and used to fetch the page's resources, and the
  banner says the markup came from a browser session. Strip any marker the
  browser tooling injected (e.g. a 🐴 in the title) from the saved HTML first.
- **Never click through a consent or legal banner** (DLA and similar
  government sites) to get a page. Leave that source as a plain link, and say
  so.
- **A PDF is already a document.** The tool refuses PDF URLs; a datasheet goes
  in the record's datasheet field (and gets mirrored), not a snapshot.
- **An HTTP error** (403, 404, 429) fails the capture with a hint to use
  `--from-html`. Do not record a failed capture as a source.
- Add `--pdf` only when a PDF is wanted beside the HTML.

## Files

Name snapshots `<line id>-<what>-<identifier>.html` inside a per-import
folder, e.g. `.local_imports/snapshots/macservice-2026-10-04/l35-nsndepot-5962010149628.html`,
so two imports cannot overwrite each other's snapshots. Do not overwrite an
existing snapshot of the same page; a later capture gets its own name (the
default name carries the capture time).

## Attaching to an InvenTree stock line

List the file in the line's `attachments`, relative to the stock file, with a
comment saying what it is and when it was captured:

```json
"attachments": [{"file": "snapshots/macservice-2026-10-04/l03-nsn-5961007827187.html",
                 "comment": "Source snapshot (2026-10-04): NSN 5961-00-782-7187 listing, nsnparts.us"}]
```

Attachments go on the part, once per part however many lines list them.

# Original Bench Intake visual reference

Start with the [original interactive HTML prototype](bench-intake.html), [Capture](03-capture.png), [Review workspace](02-review.png) and [Inbox](01-inbox.png), then read the authoritative [experience wireframes](../05-experience.md) and [current contracts](../04-contracts.md). These are the original supplied prototype and its direct Chrome screenshots from the 1 November 2026 historical prototype review, retained byte-for-byte by explicit user request during T02. They are not regenerated concepts, application screenshots or evidence that a backend operation works. The later [concept board](../assets/review-layouts.png) is a secondary derivative illustration, not the primary reference.

The user explicitly approved the current implementation's **light/neutral palette and blue accents**. Borrow the original's compact batch hierarchy, five-stage navigation, retained evidence beside shared details, queue/selection and focused narrow-screen list → item interaction; do not convert the implementation to dark merely because these screenshots use dark mode. T02 supports manual notes/known values only. Do not invent active photo, provider, review or execution controls to fill the visual layout.

## Open and inspect

Open `bench-intake.html` directly in a browser, preferably in a disposable tab with no real inventory credentials. It includes its CSS, JavaScript and synthetic SVG imagery inline; no adjacent application assets or build are needed. It is not completely offline-self-contained: it requests Public Sans and IBM Plex Mono styles/fonts from Google Fonts (`fonts.googleapis.com` and its font CDN), with system fallbacks. Outbound links include fictional `inventree.example` destinations and illustrative manufacturer/distributor sites. These are prototype links, not a configured inventory target. Do not follow them as part of application qualification or enter private evidence into this historical prototype.

The HTML intentionally remains unchanged, including historical localStorage, timers, simulated processing/import/recovery, disposable upload previews, purchase-order controls and responsive/CSS defects. None is production code or an approved backend contract. Latest experience/contracts and the implementation plan override obsolete behavior: no PO creation, no human absence assertion authorizing an uncertain retry, no localStorage result authority, and no fake success states. The actual-mobile screenshot illustrates its missing-viewport defect; implementation tests must use true narrow CSS viewports instead. Historical review technology recommendations do not override the merged TypeScript architecture.

## Direct screenshot index

| Original file | Historical state |
| --- | --- |
| [01-inbox.png](01-inbox.png) | Batches, continue card and compact retained list |
| [02-review.png](02-review.png) | Queue, evidence and focused details workspace |
| [03-capture.png](03-capture.png) | Capture notes/evidence and inherited shared details |
| [04-processing.png](04-processing.png) | Processing overview |
| [05-images.png](05-images.png) | Image outputs |
| [06-crop-editor.png](06-crop-editor.png) | Crop editor |
| [07-table.png](07-table.png) | Alternate table after keyboard activation |
| [08-approval.png](08-approval.png) | Approval scope |
| [09-results.png](09-results.png) | First subset's simulated results |
| [10-phone.png](10-phone.png) | Prototype phone frame, not actual device proof |
| [11-mobile-viewport.png](11-mobile-viewport.png) | Historical actual mobile viewport and scaling defect |
| [12-partial-failure.png](12-partial-failure.png) | Simulated attachment failure |
| [13-recovered.png](13-recovered.png) | Simulated targeted recovery |
| [14-second-import.png](14-second-import.png) | Simulated later approval round |
| [15-compare.png](15-compare.png) | Existing-Part candidate comparison |

## Integrity and provenance

All sixteen files were copied unchanged from the coordinator-located original prototype review bundle. Source/destination SHA-256 equality was verified for each; the T02 handover records verification evidence. HTML SHA-256: `97183087171c5dc6c7e07fd423014a684087a6f1fd3bf8e4841bd8a8d85257e1`. Keep these originals unchanged when updating the live UI. New implementation screenshots belong with their task evidence, not over these historical references.

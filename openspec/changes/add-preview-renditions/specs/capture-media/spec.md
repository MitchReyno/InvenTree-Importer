# Capability delta

## MODIFIED Requirements

### Requirement: Media authorized byte reads

Original, preview, rendition and observation-crop bytes SHALL be returned only after the batch and object are authorized for the configured actor and target context, and a digest SHALL never act as an access token. Originals SHALL be served as attachments with a sandboxing content security policy. Stored previews and renditions SHALL be cacheable only privately and immutably, while a fallback served for a size not yet rendered and every observation crop SHALL be revalidated by digest, so stale bytes are never reused.

#### Scenario: Cross-batch download

- **GIVEN** a retained original in batch A
- **WHEN** its URL is requested under batch B
- **THEN** the response is 404 and no bytes are returned.

#### Scenario: Cross-batch rendition

- **GIVEN** a page with renditions in batch A
- **WHEN** any of its sizes is requested under batch B
- **THEN** the response is 404 and no bytes are returned.

#### Scenario: Private immutable preview caching

- **GIVEN** an authorized request for a page preview or one of its renditions
- **WHEN** the bytes are returned
- **THEN** the response is marked private and immutable with its exact media type, and is never marked publicly cacheable.

#### Scenario: Fallback not cached as a rendition

- **GIVEN** a browser that requested a page's `thumb` size before its renditions existed
- **WHEN** the page is backfilled and the same URL is requested again
- **THEN** the WebP rendition is returned, not the cached fallback.

#### Scenario: Revalidated observation crop

- **GIVEN** an observation crop that a browser has cached with its digest validator
- **WHEN** the observation's region changes and the crop is requested again
- **THEN** the new crop bytes are returned rather than the cached ones, and an unchanged region answers `304 Not Modified`.

## ADDED Requirements

### Requirement: Media preview renditions

Every ready page of an original or derived version SHALL have aspect-preserving WebP renditions with long edges of at most 320 (`thumb`), 960 (`card`) and 2048 (`view`) pixels, produced by the bounded decoder and committed with the page. A size SHALL be omitted when the page is no larger than it, the full-resolution preview SHALL stay unchanged, and the snapshot SHALL list each page's renditions with their dimensions.

#### Scenario: Photo renditions

- **GIVEN** a retained 4032 × 3024 JPEG photo
- **WHEN** it is decoded
- **THEN** its page keeps its 4032 × 3024 full preview and lists `thumb` 320 × 240, `card` 960 × 720 and `view` 2048 × 1536 WebP renditions.

#### Scenario: Small source

- **GIVEN** a retained 800 × 600 PNG
- **WHEN** it is decoded
- **THEN** its page lists only a `thumb` rendition, and the `card` and `view` sizes resolve to the full page.

#### Scenario: Multi-page document

- **GIVEN** a retained three-page PDF
- **WHEN** it is decoded
- **THEN** each page has its own renditions, and the version's page count and page numbering are unchanged.

#### Scenario: Derived crop renditions

- **GIVEN** a documentary crop derived from a photo
- **WHEN** the derivation is decoded
- **THEN** the derived version's page has its own renditions sized from the crop output, not from the source page.

#### Scenario: Failed decode

- **GIVEN** an encrypted PDF or a photo above the pixel limit
- **WHEN** it is decoded
- **THEN** the version has no previews and no renditions, and the original remains downloadable.

#### Scenario: Encoder failure is not a limit

- **GIVEN** a decode whose rendition encoding fails for a reason other than a resource limit
- **WHEN** the result is recorded
- **THEN** the version reads `interrupted`, not `limit_exceeded`, and no previews or renditions are committed.

#### Scenario: Rendition within decoder bounds

- **GIVEN** a 50-megapixel photo decoded with the existing time, memory and output limits
- **WHEN** its renditions are produced
- **THEN** the decode still completes within those limits, and a decode that would exceed them ends `limit_exceeded` with no partial previews or renditions committed.

### Requirement: Media full-resolution crop source

Documentary crops and observation crops SHALL be cut only from the retained original or the full-resolution page decoded from it, and never from a rendition. Recipe and region coordinates SHALL continue to refer to the full-resolution, orientation-normalized page dimensions.

#### Scenario: Crop after renditions exist

- **GIVEN** a decoded photo whose page has renditions
- **WHEN** a documentary crop is derived or an observation region is cropped
- **THEN** the output pixels come from the full-resolution source at the requested coordinates: a full-size, unrotated observation crop has exactly the region's dimensions, a documentary crop has the dimensions its recipe defines (swapped by an odd quarter turn), and a sized crop is that full-resolution cut downscaled.

#### Scenario: Coordinates unchanged

- **GIVEN** an observation region recorded against a page's full dimensions before this change
- **WHEN** its crop is requested after the page gains renditions
- **THEN** the crop is produced without `region_preview_mismatch`.

### Requirement: Media sized observation crops

An observation crop SHALL be requestable at the `thumb`, `card` or `view` size or at full resolution, cut from the full-resolution page and then downscaled to that long edge without upscaling. An unknown size SHALL be refused, and a request without a size SHALL return full resolution.

#### Scenario: Thumbnail crop

- **GIVEN** an observation whose region is 1800 × 1200 pixels of a photo
- **WHEN** its `thumb` crop is requested
- **THEN** a 320 × 213 image of exactly that region is returned.

#### Scenario: Small region

- **GIVEN** an observation whose region is 200 × 150 pixels
- **WHEN** its `card` crop is requested
- **THEN** the 200 × 150 region is returned unscaled.

#### Scenario: Unknown size

- **GIVEN** an authorized observation crop
- **WHEN** it is requested with a size that is not `thumb`, `card`, `view` or `full`
- **THEN** the request is refused with 400 and no bytes are returned.

### Requirement: Media rendition backfill

Ready versions decoded before renditions existed SHALL gain renditions without changing their existing previews, preview identifiers, dimensions or bytes, without operator action and without blocking other decoding. Until a page has renditions, a requested size SHALL resolve to its full-resolution preview.

#### Scenario: Retained version upgraded

- **GIVEN** a ready version whose page has a full preview and no renditions
- **WHEN** the media worker runs
- **THEN** the page gains its renditions, and its `preview_id`, dimensions and preview bytes are unchanged.

#### Scenario: Request before backfill

- **GIVEN** a page that does not yet have renditions
- **WHEN** its `thumb` size is requested
- **THEN** the full-resolution preview is returned.

#### Scenario: Small page backfill settles

- **GIVEN** a retained version whose pages are all no larger than 320 pixels on their long edge
- **WHEN** the media worker runs repeatedly
- **THEN** the version is never selected for backfill, because no rendition is expected for it.

#### Scenario: Backfill interrupted

- **GIVEN** a backfill decode that is interrupted or fails
- **WHEN** the worker runs again
- **THEN** the page still has its full preview, no partial set of renditions is visible, the version's decode state and version count are unchanged, and the backfill is retried on a later run up to a bounded number of attempts.

#### Scenario: Source changed

- **GIVEN** a retained version whose re-decoded page no longer matches the recorded page dimensions
- **WHEN** its backfill completes
- **THEN** no renditions are recorded for it and its existing preview is unchanged.

### Requirement: Media previews fit their surface

The frontend SHALL request the smallest suitable rendition for each image surface, offering the available sizes so the browser can choose for its pixel density, and SHALL request full resolution only where the operator inspects detail beyond the largest rendition or opens the image on its own. Image elements SHALL declare their intrinsic size so layout does not shift while they load. When a size is unavailable, the surface SHALL show the next size up or the full page.

#### Scenario: Thumbnail surfaces

- **GIVEN** a batch with decoded photos and observations
- **WHEN** the batch list, needs-you panel or observation thumbnails are shown
- **THEN** they load `thumb` renditions or `thumb` crops, not full-resolution pages.

#### Scenario: Evidence cards

- **GIVEN** decoded evidence shown in Capture cards and file tiles
- **WHEN** the cards render
- **THEN** they load a `card`-sized or smaller rendition for the device's pixel density.

#### Scenario: Viewer zoom

- **GIVEN** the evidence viewer open on a photo
- **WHEN** it first renders and when the operator zooms beyond the `view` rendition's resolution
- **THEN** it first loads the `view` rendition, and loads the full-resolution page only after that zoom.

#### Scenario: Crop selection

- **GIVEN** the crop dialog on a photo
- **WHEN** the operator selects a region over a displayed rendition
- **THEN** the recorded selection is in full-resolution page coordinates, identical to a selection made over the full page.

#### Scenario: Open on its own

- **GIVEN** a page in the Processing images list
- **WHEN** the operator opens it
- **THEN** the full-resolution page opens.

#### Scenario: Missing rendition

- **GIVEN** a page that has no renditions yet
- **WHEN** any surface shows it
- **THEN** the image still displays, using the full-resolution page.

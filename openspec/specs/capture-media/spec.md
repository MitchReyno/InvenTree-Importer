# capture-media Specification

## Purpose

Retain photo and document originals as private immutable bytes, decode them only in a bounded isolated worker, derive deterministic documentary crops, and freeze the attachments an operator selects. A receipt always means durable bytes, never that a file was readable or will be attached.

## Requirements

### Requirement: Media retained originals

An upload of at most 20 MiB SHALL be stored once, by its server-computed SHA-256 digest, in private content-addressed storage before the evidence version commits, under the media revision and a payload-bound idempotency key. A receipt SHALL mean the bytes are durable and owned by the batch, not that they decoded, and client labels and declared types SHALL be metadata only.

#### Scenario: Retain and replay an upload

- **GIVEN** an editable batch with media enabled
- **WHEN** a file is uploaded and the same request is replayed
- **THEN** the replay returns the original receipt with the server-computed digest and a `queued` version, the same key with different bytes is refused with 409, and a new key at the old media revision is refused with 412.

#### Scenario: Lost receipt

- **GIVEN** an upload whose response is lost after the bytes were retained
- **WHEN** the server restarts and the same request is sent again
- **THEN** the original evidence is adopted and exactly one evidence item exists for it.

#### Scenario: Shared bytes

- **GIVEN** two evidence items with identical bytes
- **WHEN** both are retained
- **THEN** one blob holds the bytes and each evidence item keeps its own identity, links and history.

### Requirement: Media private store binding

The media root SHALL be private and bound to one immutable database store identity, and startup SHALL refuse a root bound to another database, an unmarked non-empty root or media configuration without a database. Path traversal, symbolic links, public directories and oversized byte streams SHALL fail closed.

#### Scenario: Foreign database

- **GIVEN** a media root bound to one database
- **WHEN** the server starts against a different database with that root
- **THEN** it refuses before listening.

### Requirement: Media authorized byte reads

Original and preview bytes SHALL be returned only after the batch and object are authorized for the configured actor and target context, and a digest SHALL never act as an access token. Originals SHALL be served as attachments with a sandboxing content security policy.

#### Scenario: Cross-batch download

- **GIVEN** a retained original in batch A
- **WHEN** its URL is requested under batch B
- **THEN** the response is 404 and no bytes are returned.

### Requirement: Media isolated bounded decoding

JPEG, PNG and PDF originals SHALL be decoded only by an explicitly started worker in a pinned container with no network and with filesystem, memory, process, page, pixel and time limits. Each version SHALL end `ready`, `unsupported`, `encrypted`, `malformed`, `limit_exceeded` or `interrupted`, and a failed decode SHALL leave the original and all other evidence retained.

#### Scenario: Encrypted PDF

- **GIVEN** a retained password-protected PDF
- **WHEN** it is decoded
- **THEN** the version reads `encrypted`, produces no previews, and the original remains downloadable.

#### Scenario: Decoder bounds

- **GIVEN** the decoder worker
- **WHEN** it runs
- **THEN** it has no network and a read-only root, renders at most 30 PDF pages, and refuses more than 52 million pixels per page or 104 million in total.

#### Scenario: Oversized document

- **GIVEN** a PDF with too many pages or pixels, or a photo above the pixel limit
- **WHEN** it is decoded
- **THEN** the version reads `limit_exceeded` with no pages, and is not reported as interrupted.

### Requirement: Media immutable derived crops

A derived image SHALL be produced from an immutable recipe naming the exact source version, digest, page and dimensions, with coordinates in the orientation-normalized source, and its output bytes, dimensions and decoder toolchain SHALL be retained. A changed request SHALL create a new derivation rather than alter an old one.

#### Scenario: Crop then rotate

- **GIVEN** a retained photo with EXIF orientation
- **WHEN** a crop with one quarter turn is derived
- **THEN** the crop coordinates refer to the upright source, the output pixels are cropped then rotated, and the original version is unchanged.

#### Scenario: Rotated region

- **GIVEN** a `documentary-rotated-region/1` recipe for an oblique selection
- **WHEN** it is derived
- **THEN** the selection is extracted upright and the source image is not rotated.

#### Scenario: Restricted decoder

- **GIVEN** the decoder role
- **WHEN** it publishes derived bytes
- **THEN** it cannot edit drafts, links or attachment selections.

### Requirement: Media orphan collection

Blob publication and collection SHALL take the same digest-level exclusion, so a failed publication MAY leave an unreferenced orphan but never a version that points to missing bytes. Collection SHALL remove only aged blobs with no committed reference, and SHALL never remove retained bytes, pins or history.

#### Scenario: Rollback during publication

- **GIVEN** a publisher whose transaction rolls back after writing bytes
- **WHEN** the collector later runs past the age cutoff
- **THEN** only that orphan is removed and every referenced blob remains readable.

#### Scenario: Recent cutoff

- **GIVEN** a collection request with a cutoff that is too recent
- **WHEN** it runs
- **THEN** it is refused and nothing is collected.

### Requirement: Media attachment selection

An operator SHALL select, decline or unset an original or derived version as a lot or Part attachment, as a versioned human choice refused for retired lots. Preparation SHALL freeze the selected versions, digests and destinations, and a later change to the current selection MUST NOT alter an approved plan.

#### Scenario: Retired lot

- **GIVEN** a lot retired by a split
- **WHEN** an attachment is selected for it or evidence is linked to it
- **THEN** the change is refused with `lot_retired`.

#### Scenario: Part attachment without the capability

- **GIVEN** a deployment whose capability supports only lot media
- **WHEN** a lot whose Part has a selected Part attachment is reviewed or prepared
- **THEN** review is refused and preparation is blocked with `unsupported_part_attachment`, and no attachment request is sent.

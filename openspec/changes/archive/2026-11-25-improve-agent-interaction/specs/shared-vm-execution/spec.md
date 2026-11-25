## MODIFIED Requirements

### Requirement: Guest-staged evidence matches the delivered image

The guest SHALL stage the image a fetch_evidence delivery carries, and record that image's own SHA-256, size and dimensions with it. A staged image whose bytes don't match the delivery's stated digest SHALL be refused before the provider sees it. The cited source reference SHALL remain the original version. On a compatible bridge, the guest SHALL stage a legacy-format reply under the earlier digest rules.

#### Scenario: Script crops a bounded delivery

- **GIVEN** a VM session that fetched a 6144 × 8160 photo, delivered at 1940 × 2576
- **WHEN** a guest script reads the staged local file
- **THEN** the file is the 1940 × 2576 image, its recorded digest matches its bytes, and the scale needed to map back to page-preview pixels is in the result.

#### Scenario: Tampered delivery

- **GIVEN** a delivery whose image bytes don't match its stated delivered digest
- **WHEN** the guest stages it
- **THEN** staging fails with `invalid_evidence_file` and the provider receives no image.

## ADDED Requirements

### Requirement: Tool workers negotiate evidence release confirmation

Before dispatching a tool-capable VM turn, the coordinator and guest SHALL negotiate support for confirming release of evidence to the provider. Either peer SHALL refuse dispatch if its counterpart lacks support. Both delivery modes SHALL grant new citation authority only after a matching confirmation on the active turn channel.

#### Scenario: Mixed bridge versions

- **GIVEN** one peer lacks support for release confirmation
- **WHEN** the other peer negotiates a tool-capable VM turn
- **THEN** the provider turn does not start, for either inline or file delivery.

#### Scenario: A compatible bridge carries legacy-format evidence

- **GIVEN** both peers negotiated release confirmation
- **WHEN** the producing coordinator explicitly identifies its response format as legacy and the guest receives a legacy preview without a rendition digest
- **THEN** it stages the preview under the earlier digest rules and confirms only after writing the provider-facing response.


#### Scenario: Missing rendition metadata cannot downgrade a current image

- **GIVEN** the coordinator producing a current-format image labels the private delivery envelope as current using its producer version
- **WHEN** the rendition metadata is missing or malformed, even if page metadata is present
- **THEN** the guest refuses the delivery before exposing the image or confirming release.
- **AND** an image envelope with a missing or unknown format label is refused.

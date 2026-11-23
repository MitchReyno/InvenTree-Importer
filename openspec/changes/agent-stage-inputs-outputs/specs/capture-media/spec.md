## MODIFIED Requirements

### Requirement: Media immutable derived crops

A derived image SHALL be produced from an immutable recipe naming the exact source version, digest, page and dimensions, with coordinates in the orientation-normalized source, and its output bytes, dimensions and decoder toolchain SHALL be retained. A recipe MAY also straighten by an angle of at most 15° and apply bounded light adjustments: contrast, gamma and sharpening that keep hue, and a white balance whose per-channel gains are bounded so colours that carry information stay distinguishable. A changed request SHALL create a new derivation rather than alter an old one.

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

#### Scenario: Straightened, lit crop

- **GIVEN** a recipe with a quarter turn, −3.5° straightening and white balance on a photo of a resistor
- **WHEN** it is derived
- **THEN** the output is cut from the upright source, straightened without exposing unfilled corners, and the colour cast is reduced while the resistor's band colours shift at most 5° in hue.

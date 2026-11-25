## MODIFIED Requirements

### Requirement: Media immutable derived crops

A derived image SHALL be produced from an immutable recipe naming the exact source version, digest, page and dimensions, with coordinates in the orientation-normalized source, and its output bytes, dimensions and decoder toolchain SHALL be retained. A recipe MAY also straighten by an angle of at most 15° and apply bounded light adjustments: contrast, gamma and sharpening that keep hue, and a white balance whose per-channel gains are bounded and scaled back so no saturated colour shifts more than 5° in hue. Hue is protected only where 8-bit pixels can carry it: a colour whose brightest channel or channel spread is below 16 levels has no hue protected, and the light adjustments MAY turn or erase it. A changed request SHALL create a new derivation rather than alter an old one.

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

#### Scenario: Dark colour below the hue floor

- **GIVEN** a recipe with white balance on a photo with a warm cast and a near-black, fully saturated pixel of RGB 10, 4, 0
- **WHEN** it is derived
- **THEN** the white balance isn't held back for that pixel, whose brightest channel and channel spread are below 16 levels, and its hue may turn by more than 5°.

#### Scenario: Straightened, lit crop

- **GIVEN** a recipe with a quarter turn, −3.5° straightening and white balance on a photo of a resistor
- **WHEN** it is derived
- **THEN** the output is cut from the upright source, straightened without exposing unfilled corners, and the colour cast is reduced while the resistor's band colours shift at most 5° in hue.

## ADDED Requirements

### Requirement: Match findings block approval

Preparation SHALL be blocked for a lot with an open match question or an unresolved finding from Match's validation before approval.

#### Scenario: Unresolved finding

- **GIVEN** a lot whose validation found a Part created since its decision
- **WHEN** preparation runs
- **THEN** it is blocked for that lot with the finding named.

### Requirement: Confirmed images and gap fills become effects

Preparation SHALL include a confirmed Part image as the image of the created Part, or of an existing target Part that has none, where the target's capability allows it, confirmed stock images as stock attachments, and, for a lot decided as fill what's missing, update effects for only the existing Part's missing fields.

#### Scenario: Fill what's missing

- **GIVEN** a lot decided as fill what's missing for MCU-0012, whose datasheet was missing, with a confirmed Research datasheet
- **WHEN** preparation runs
- **THEN** the plan adds the datasheet to MCU-0012 and stock for the lot, and changes no other field of MCU-0012.

#### Scenario: Add stock to a Part without an image

- **GIVEN** a lot decided as add stock to RES-0144, which has no image, with a confirmed Part image and stock image
- **WHEN** preparation runs
- **THEN** the plan sets RES-0144's image, adds the stock with its image attached, and changes nothing else on RES-0144.

## ADDED Requirements

### Requirement: Match findings block approval

Preparation SHALL be blocked for a lot with an open match question or an unresolved finding from Match's validation before approval.

#### Scenario: Unresolved finding

- **GIVEN** a lot whose validation found a Part created since its decision
- **WHEN** preparation runs
- **THEN** it is blocked for that lot with the finding named.

### Requirement: Confirmed images and gap fills become effects

Preparation SHALL include a confirmed Part image as the created Part's image, confirmed stock images as stock attachments, and, for a lot decided as fill what's missing, update effects for only the existing Part's missing fields.

#### Scenario: Fill what's missing

- **GIVEN** a lot decided as fill what's missing for MCU-0012, whose datasheet was missing, with a confirmed Research datasheet
- **WHEN** preparation runs
- **THEN** the plan adds the datasheet to MCU-0012 and stock for the lot, and changes no other field of MCU-0012.

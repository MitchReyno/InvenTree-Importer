## ADDED Requirements

### Requirement: Match findings block approval

Preparation SHALL be blocked for a selected `/7` lot with an open match question or an unresolved finding from Match's validation before approval.

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

### Requirement: Existing-Part writes expect an empty field

Each gaps fill SHALL carry the value it expects to be missing, and an existing Part's image effect SHALL expect the Part to have no image. The executor SHALL re-read the field or image just before the write and refuse the effect as a conflict when it is no longer empty. InvenTree has no conditional update, so a competing write between that re-read and the write MAY still be overwritten; the effect SHALL state this window.

#### Scenario: Field filled after preparation

- **GIVEN** a prepared plan that fills MCU-0012's missing datasheet
- **WHEN** someone adds a datasheet to MCU-0012 before the effect runs
- **THEN** the executor re-reads the field just before the update, refuses the effect as a conflict and records it, and doesn't replace the datasheet.

#### Scenario: Image added after preparation

- **GIVEN** a prepared plan that sets RES-0144's image because it had none
- **WHEN** someone adds an image to RES-0144 before the effect runs
- **THEN** the executor re-reads the Part just before the upload, refuses the effect as a conflict and records it, and doesn't replace the image.

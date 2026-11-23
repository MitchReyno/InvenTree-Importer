## ADDED Requirements

### Requirement: Match findings block approval

Preparation SHALL be blocked for a selected `/7` lot with an open match question, a pending interactive search, a pending amendment, or an unresolved finding from Match's validation before approval. Validation SHALL run only on a settled Match outcome, record its own result, and SHALL NOT supersede a match question.

#### Scenario: Open question at preparation

- **GIVEN** a selected `/7` lot with an open match question, or with an interactive search still pending
- **WHEN** preparation runs
- **THEN** it is blocked for that lot, runs no validation search for it, and the question stays open.

#### Scenario: Unresolved finding

- **GIVEN** a lot whose validation found a Part created since its decision
- **WHEN** preparation runs
- **THEN** it is blocked for that lot with the finding named.

### Requirement: Existing-Part targets need their photos

Preparation SHALL be blocked for a selected `/7` lot decided as add stock, or add stock and fill what's missing, that has no confirmed stock image. It SHALL also need a confirmed Part image when the target Part has none, and SHALL NOT need one when the Part has an image.

#### Scenario: Missing stock photo

- **GIVEN** a lot decided as add stock to RES-0144, which has an image, with no confirmed stock image
- **WHEN** preparation runs
- **THEN** it is blocked for that lot, naming the missing stock photo, and doesn't ask for a Part image.

#### Scenario: Missing Part photo

- **GIVEN** a lot decided as add stock to RES-0144, which has no image, with a confirmed stock image and no confirmed Part image
- **WHEN** preparation runs
- **THEN** it is blocked for that lot, naming the missing Part photo.

### Requirement: Confirmed images and gap fills become effects

Preparation SHALL include a confirmed Part image as the image of the created Part, or of an existing target Part that has none, where the target's capability allows it, every confirmed stock image of the lot, each as its own stock attachment (at most 8 per stock operation and 64 per plan, with a lot or preparation over either limit blocked, naming it), and, for a lot decided as fill what's missing, update effects for only the existing Part's missing fields.

#### Scenario: Fill what's missing

- **GIVEN** a lot decided as fill what's missing for MCU-0012, whose datasheet was missing, with a confirmed Research datasheet
- **WHEN** preparation runs
- **THEN** the plan adds the datasheet to MCU-0012 and stock for the lot, and changes no other field of MCU-0012.

#### Scenario: Add stock to a Part without an image

- **GIVEN** a lot decided as add stock to RES-0144, which has no image, with a confirmed Part image and stock image
- **WHEN** preparation runs
- **THEN** the plan sets RES-0144's image, adds the stock with its image attached, and changes nothing else on RES-0144.

### Requirement: One Part image per Part

Preparation SHALL plan at most one Part image effect per target Part. When selected lots targeting the same Part confirm different Part images, preparation SHALL be blocked until the operator chooses one; each lot's stock images SHALL stay its own.

#### Scenario: Two lots, one Part

- **GIVEN** lots A and B decided as add stock to RES-0144, which has no image, each with a different confirmed Part image
- **WHEN** preparation runs
- **THEN** it is blocked asking which image RES-0144 gets, and after the choice the plan sets that image once and attaches each lot's stock images to its own stock.

### Requirement: One fill per Part field

Preparation SHALL plan at most one gaps fill per target Part and field. Identical confirmed values from several lots SHALL be coalesced into one fill; different values SHALL block preparation until the operator chooses one.

#### Scenario: Two lots fill one datasheet

- **GIVEN** lots A and B decided as fill what's missing for MCU-0012, each with a different confirmed datasheet
- **WHEN** preparation runs
- **THEN** it is blocked asking which datasheet MCU-0012 gets, and when both confirmed the same one, the plan fills it once.

### Requirement: Parameter fills create or update

A gaps fill for a key parameter SHALL create the value when the Part has no row for its template, expecting no row, and SHALL update the row when one exists with an empty value, expecting it empty. Both SHALL be `owned-fake-effects/3` effects, and each SHALL re-read its precondition just before the send.

#### Scenario: Value row appears before the send

- **GIVEN** a planned create of MCU-0012's missing tolerance parameter
- **WHEN** someone adds that parameter before the effect runs
- **THEN** the executor's re-read finds the row, refuses the effect as a conflict and records it, and creates nothing.

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

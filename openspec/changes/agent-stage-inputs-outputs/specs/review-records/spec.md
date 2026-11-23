## ADDED Requirements

### Requirement: Agent values are proposed until confirmed

Values from `/7` typed outputs, Examine's identity and Research's output, SHALL fill an agent-made Part's spec as proposed values, each showing its stage and source, until the operator confirms them. They SHALL NOT overwrite operator values. Each field SHALL come from the stage that owns it.

#### Scenario: Confirm a proposed parameter

- **GIVEN** Research proposed a 16 MHz frequency from the datasheet for an agent-made crystal Part
- **WHEN** the operator opens the Part in Review › Records
- **THEN** the frequency shows as proposed by Research with its source, and confirming it makes it the Part's value.

#### Scenario: Confirming a different MPN

- **GIVEN** a `/7` lot whose merged identity has MPN 1N4148W-7-F, with a proposed MPN 1N4148WS-7-F on its Part
- **WHEN** the operator confirms 1N4148WS-7-F
- **THEN** the lot's identity revision advances with the operator as source, and Match searches again before the lot can be prepared.

#### Scenario: Retained earlier proposal

- **GIVEN** a retained `/6` Research proposal with a frequency
- **WHEN** the operator opens the Part in Review › Records
- **THEN** the value shows only as an attribution, as before, and fills no proposed value.

## MODIFIED Requirements

### Requirement: Locations view

Records SHALL include Locations, listing the stock locations the batch's stock goes into, with each location's path, why it is used (batch default or lot override) and its stock count. Selecting one SHALL show its name, path, description, location type and the stock going there, plus an ask box for the Inventory step. Changing the mapping SHALL follow the existing unsupported-change rule where the app can't yet store it.

For a batch whose Examine lead input is `bench-intake-input/7`, which has no Inventory step, the ask box SHALL NOT be shown. Its locations SHALL instead be proposed by the app from the batch defaults and the matched Part's existing stock locations, each shown as proposed with its reason until the operator confirms it in Review; confirming one not yet in Capture first retains its location observation through a scoped read in the current target context. Batches with no lead or an earlier-version lead SHALL keep the ask box for the Inventory step.

#### Scenario: Override location

- **GIVEN** two lots override the batch default location with Bench bin B3
- **WHEN** the operator opens Records › Locations
- **THEN** Bench bin B3 is listed with "from 2 lot overrides" and its two stock items

#### Scenario: Location proposed for a matched Part

- **GIVEN** a `/7` batch whose lot was decided as add stock to RES-0144, which has stock in Drawer 4
- **WHEN** the operator opens Records › Locations
- **THEN** Drawer 4 is listed as proposed "from RES-0144's existing stock" with no ask box, and confirming it sets that lot's location

### Requirement: Unsupported record changes are honest

Retained proposals the executor cannot apply SHALL be shown as “Not supported yet”, together with the nearest supported choice, and SHALL never be silently dropped. These include creating a category, a parameter template or a manufacturer company, changing fields of an existing Part, and supplier prices. The exceptions, each a capability-gated effect, are a confirmed `/7` gaps fill of a missing datasheet or key parameter, and a confirmed Part image for an image-less existing Part under either add stock decision.

#### Scenario: New category proposed

- **GIVEN** a retained proposal for a new sub-category
- **WHEN** the Part record opens
- **THEN** the category field explains that creating categories is not supported yet, and offers the existing categories, with the agent's reason.

#### Scenario: Part image under plain add stock

- **GIVEN** a `/7` lot decided as add stock to RES-0144, which has no image, with a confirmed Part image
- **WHEN** the Part record opens
- **THEN** the image shows as one approval can set, not as unsupported.

#### Scenario: Confirmed gaps fill on an existing Part

- **GIVEN** a `/7` lot decided as fill what's missing for MCU-0012, with a confirmed datasheet, and a retained proposal to change MCU-0012's description
- **WHEN** the Part record opens
- **THEN** the datasheet shows as a fill that approval can apply, and the description change shows as not supported yet.

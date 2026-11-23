## ADDED Requirements

### Requirement: Agent values are proposed until confirmed

Values from Examine's identity and Research's output SHALL fill an agent-made Part's spec as proposed values, each showing its stage and source, until the operator confirms them. They SHALL NOT overwrite operator values. Each field SHALL come from the stage that owns it.

#### Scenario: Confirm a proposed parameter

- **GIVEN** Research proposed a 16 MHz frequency from the datasheet for an agent-made crystal Part
- **WHEN** the operator opens the Part in Review › Records
- **THEN** the frequency shows as proposed by Research with its source, and confirming it makes it the Part's value.

## MODIFIED Requirements

### Requirement: Locations view

Records SHALL include Locations, listing the stock locations the batch's stock goes into, with each location's path, why it is used (batch default or lot override) and its stock count. Selecting one SHALL show its name, path, description, location type and the stock going there, plus an ask box for the Inventory step. Changing the mapping SHALL follow the existing unsupported-change rule where the app can't yet store it.

For a batch whose Examine lead input is `bench-intake-input/7`, which has no Inventory step, the ask box SHALL NOT be shown. Its locations SHALL instead be proposed by the app from the batch defaults and the matched Part's existing stock locations, each shown as proposed with its reason until the operator confirms it in Review. Batches with no lead or an earlier-version lead SHALL keep the ask box for the Inventory step.

#### Scenario: Override location

- **GIVEN** two lots override the batch default location with Bench bin B3
- **WHEN** the operator opens Records › Locations
- **THEN** Bench bin B3 is listed with "from 2 lot overrides" and its two stock items

#### Scenario: Location proposed for a matched Part

- **GIVEN** a `/7` batch whose lot was decided as add stock to RES-0144, which has stock in Drawer 4
- **WHEN** the operator opens Records › Locations
- **THEN** Drawer 4 is listed as proposed "from RES-0144's existing stock" with no ask box, and confirming it sets that lot's location

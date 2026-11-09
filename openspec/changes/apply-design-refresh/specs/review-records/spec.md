# Capability delta

## ADDED Requirements

### Requirement: Descriptions on records

Review › Records SHALL show each record's description as described in the design system:

- **Part:** editable, with its count.
- **Existing category, company, parameter template and location:** read-only, from InvenTree where the existing-values read provides them.
- **New location or supplier created in Capture:** the description entered with it.
- **Manufacturer part, supplier part, agent-proposed company, category or parameter template, location type, and any existing value the read doesn't provide:** disabled fields explaining that agent-written descriptions for these come later.

#### Scenario: Existing company description

- **GIVEN** a manufacturer mapped to existing InvenTree company #41
- **WHEN** Records › Companies shows it
- **THEN** its InvenTree description appears read-only with "InvenTree · Existing"

### Requirement: Locations view

Records SHALL include Locations, listing the stock locations the batch's stock goes into, with each location's path, why it is used (batch default or lot override) and its stock count. Selecting one SHALL show its name, path, description, location type and the stock going there, plus an ask box for the Inventory step. Changing the mapping SHALL follow the existing unsupported-change rule where the app can't yet store it.

#### Scenario: Override location

- **GIVEN** two lots override the batch default location with Bench bin B3
- **WHEN** the operator opens Records › Locations
- **THEN** Bench bin B3 is listed with "from 2 lot overrides" and its two stock items

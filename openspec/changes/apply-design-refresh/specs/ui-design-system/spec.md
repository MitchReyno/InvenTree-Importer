# Capability delta

## ADDED Requirements

### Requirement: AI mark at agent touchpoints

The AI sparkle (`AiMark`, `ai` on `ai-weak`) SHALL mark the places where the operator meets an agent: the activity chip, the Agents page and Agent settings, session drawer headers, live agent lists (Proposed lots, Agent sessions) and every free-text Ask, Tell or Instructions box. Per-field Ask buttons don't carry it. It SHALL NOT mark proposed values, source chips, pills, counts or table rows. It SHALL centre on its label and be hidden from assistive technology, since the label names the agent. Pills SHALL NOT use a sparkle glyph; New uses ＋.

#### Scenario: Marked once per touchpoint

- **GIVEN** the Part record screen
- **WHEN** it renders
- **THEN** the "Ask an agent about this Part" box carries the mark, and none of the Part's values or source chips do

### Requirement: Short source chips with details on demand

A source chip SHALL show the source and an info indicator, plus a leading glyph when the certainty needs attention: `?` for Likely — check or Estimate, `×` for Sources disagree, `✎` for the operator's edit. It SHALL be a button whose accessible name gives the source and certainty. Activating it SHALL open a popover with the field and value, the certainty, one sentence on why, the evidence it came from and where else the value appears, and Open evidence and Edit value actions. The full "source · certainty" text SHALL be available as its tooltip.

#### Scenario: Read why a value is trusted

- **GIVEN** a Resistance value read from a packet label and the packing slip
- **WHEN** the operator activates its "Packet label" chip
- **THEN** the popover says "Label and slip agree", explains both sources, shows the label crop, and offers Open evidence

#### Scenario: Attention survives without colour

- **GIVEN** a value whose sources disagree
- **WHEN** it renders in either theme
- **THEN** its chip shows `×` before the source, so the warning doesn't rely on colour

### Requirement: Help instead of helper text

Headings, legends and shortcut lists SHALL NOT carry grey explanatory sentences. Where an explanation is needed, a `HelpButton` (a help icon on an `accent-weak` disc, with an accessible name saying what it explains) SHALL open it as a popover, with a tooltip on hover.

#### Scenario: Explain groups on demand

- **GIVEN** Capture's evidence heading
- **WHEN** the operator activates "About groups"
- **THEN** the explanation of groups opens beside it, and Escape closes it with focus returned

### Requirement: Descriptions with InvenTree's limits

Wherever a record has an InvenTree description (Part, category, company, manufacturer part, supplier part, parameter template, stock location, location type), screens SHALL show it with its source and a character count against InvenTree's limit: 500 for companies, 250 for the rest. Stock items SHALL show no description. A description over its limit SHALL show the count in the bad tone. A proposed description the app would write SHALL block approval until it fits; an existing InvenTree description is shown but doesn't block, because the app doesn't write it. Descriptions the app can't yet store or read SHALL render as disabled fields with an explanation.

#### Scenario: Count against the limit

- **GIVEN** a company description of 71 characters
- **WHEN** it renders
- **THEN** it shows "71 / 500" with its source chip

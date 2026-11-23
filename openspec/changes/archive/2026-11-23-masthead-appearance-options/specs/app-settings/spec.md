# Capability delta

## MODIFIED Requirements

### Requirement: InvenTree and appearance sections

Settings › InvenTree SHALL show the existing server label, connection state, last check time and an Open InvenTree link, without showing credentials. Settings › Appearance SHALL hold the System, Light and Dark theme choice that the retired masthead menu held, with the same stored preference. It SHALL also hold a Masthead choice of In the bar, Behind the whole window and Fading down, remembered on the device, defaulting to In the bar and applied immediately. The masthead and theme choices SHALL be independent: either can be changed without changing the other.

#### Scenario: Theme moves without loss

- **GIVEN** the operator had chosen Dark in the old masthead menu
- **WHEN** they open Settings › Appearance after this change
- **THEN** Dark is selected, and changing it updates the theme immediately

#### Scenario: Masthead choice is remembered

- **GIVEN** Settings › Appearance with In the bar selected
- **WHEN** the operator chooses Fading down and reloads the app
- **THEN** the masthead changes as soon as they choose, and after the reload Fading down is still selected and shown

#### Scenario: Masthead and theme stay independent

- **GIVEN** the theme choice Light and the masthead choice In the bar
- **WHEN** the operator chooses Behind the whole window and then the theme Dark
- **THEN** the app shows the whole-window masthead in the dark theme, and both choices are still selected after a reload

#### Scenario: Storage unavailable

- **GIVEN** browser storage that is missing or throws
- **WHEN** the app starts and the operator changes the masthead choice
- **THEN** the app starts with In the bar, the new choice applies for the session, and no error is shown

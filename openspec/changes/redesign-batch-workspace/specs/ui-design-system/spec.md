# Capability delta

## Purpose

The app looks and reads as one calm, dense, bench-practical tool in light and dark themes. It uses the Bench Intake Design System's tokens, components and content rules, so that every screen states things in bench language and shows provenance only on demand.

## ADDED Requirements

### Requirement: Token-driven themes

Every colour, radius, spacing and shadow used by the UI SHALL come from design-system tokens exposed as CSS custom properties, with a light and a dark value for each colour. The app SHALL follow the operating-system colour scheme by default and offer an explicit Light, Dark or System choice that is remembered in the browser. Component styles MUST NOT contain literal colours outside the token definitions, except inside photo and evidence content.

#### Scenario: Switch to dark

- **GIVEN** the app open with the System choice and an OS in light mode
- **WHEN** the operator chooses Dark
- **THEN** every screen redraws with the dark token values without reload, the choice persists across reloads in that browser, and form controls and scrollbars use the dark scheme.

#### Scenario: Storage unavailable

- **GIVEN** browser storage that throws or is empty
- **WHEN** the app loads
- **THEN** it follows the OS scheme and the theme control still works for the session.

### Requirement: Legible in both themes

Text tokens SHALL meet 4.5:1 contrast against the surfaces they are used on in both themes (3:1 for text 24px or larger). Focus SHALL be a 2px solid accent outline with an offset, visible on every interactive element. Status SHALL always pair colour with a glyph and a word.

#### Scenario: Automated contrast check

- **GIVEN** the token set
- **WHEN** the contrast check runs over each text token and its documented grounds in light and dark
- **THEN** every pair passes its threshold, or the build fails naming the pair.

### Requirement: Typography and self-hosted fonts

The UI SHALL use Public Sans for text and IBM Plex Mono for part numbers, IPNs, SKUs, date codes and keyboard keys. Both are served from the app itself, with system fallbacks. The type scale SHALL follow the design-system styles (h1 20, h2 16, h3 14, body 14/20, small 12.5, label 11 uppercase, mono 12.5).

#### Scenario: Offline load

- **GIVEN** no internet access from the browser
- **WHEN** the app loads from the local server
- **THEN** both fonts render from local assets and no request is made to a third-party font host.

### Requirement: Provenance on demand

Screens SHALL use bench language and InvenTree nouns. IDs, digests, revisions, versions and actor identities SHALL appear only behind a source chip, viewer or Details disclosure, never inline in normal content. Uncertainty SHALL be described in words ("Likely — check", "Sources disagree"), never as a percentage.

#### Scenario: No internal identifiers inline

- **GIVEN** a Capture evidence tile and a Review lot
- **WHEN** they render normally
- **THEN** no evidence ID, original digest, revision number or actor UUID is shown; opening the viewer's Details reveals them.

### Requirement: Limits stated once

Each limit (test InvenTree target, unverified agents, unavailable feature) SHALL be stated once, in its owning place: the connection details, Agent settings, a disabled-feature box or the Changes footer.

#### Scenario: Test target stated once

- **GIVEN** the connected target is the owned fake
- **WHEN** the operator moves through Capture, Review and Changes
- **THEN** only the connection status and the Changes footer and outcome strip name the test target; no page repeats a disclaimer footer.

### Requirement: Masthead and electronics current in both themes

The masthead SHALL be one bar over the electronics current (option A). The current SHALL keep its existing behaviour: WebGL 2 detection, lazy loading, reduced-motion still frame, pointer stir, LED pulse and display cycling. It SHALL have a dark finish (outline, crease and fill tints) used under the dark theme, with outlines at least 3:1 against the masthead ground.

#### Scenario: Dark masthead

- **GIVEN** the dark theme
- **WHEN** the masthead renders with WebGL 2 available
- **THEN** the parts use the dark finish on the dark masthead ground, remain visible, and never overlap header text.

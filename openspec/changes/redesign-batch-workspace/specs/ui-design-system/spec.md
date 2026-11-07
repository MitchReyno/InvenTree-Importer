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

### Requirement: Token-driven layout and type

Every spacing, radius, shadow, type style, stacking layer, breakpoint, opacity and fixed size used by a component SHALL come from a design-system token where one exists. Component styles MUST NOT contain those values as literals, except where the design system keeps them local: the masthead scene's palette and photo masks.

#### Scenario: Literal value refused

- **GIVEN** a component style containing a raw spacing, radius, z-index or duration value that a token covers
- **WHEN** the frontend lint runs
- **THEN** it fails, naming the file, line and the token to use.

### Requirement: Motion and layers follow the design system

Motion SHALL use the design system's duration and easing tokens: hover backgrounds change over 80ms, popovers and menus open over 120ms and close over 90ms, and toasts rise 8px over 150ms. All animation SHALL stop under reduced motion. Toasts SHALL stack above popovers and menus.

#### Scenario: Reduced motion

- **GIVEN** an operating system set to reduce motion
- **WHEN** a popover opens, a toast appears and a step runs
- **THEN** nothing animates, and every state is still shown.

#### Scenario: Toast above an open menu

- **GIVEN** an open masthead menu
- **WHEN** a toast appears
- **THEN** the toast is fully visible above the menu.

### Requirement: Screens use the shared components

Where the design system has a component for a control, a status, a table, a notice, a dialog or a popover, every screen SHALL use that component rather than a local copy. A status SHALL show the design's glyph and colour for its state on every screen.

#### Scenario: One status vocabulary

- **GIVEN** a record that is new in Records and new in Changes, and a running step in Processing
- **WHEN** each screen renders
- **THEN** both "New" statuses use the same pill colour and glyph, and the running step uses the running state's accent colour and glyph.

### Requirement: Layout follows the design's widths and breakpoints

Main content SHALL be at most 1240px wide (1500px for Review and Records), centred. Layouts SHALL change only at the design system's named breakpoints. At phone width the masthead SHALL stay one row, and every interactive control SHALL have a hit area of at least 44px.

#### Scenario: Wide screen

- **GIVEN** a 1920px-wide window
- **WHEN** Capture and then Review render
- **THEN** Capture's content is 1240px wide and Review's 1500px, both centred.

#### Scenario: Phone width

- **GIVEN** a 390px-wide window with the connection status shown
- **WHEN** the masthead and the Capture actions render
- **THEN** the masthead is one row, nothing scrolls horizontally, and each control's hit area is at least 44px.

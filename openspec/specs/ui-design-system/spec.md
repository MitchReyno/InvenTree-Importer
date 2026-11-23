# ui-design-system Specification

## Purpose

The app looks and reads as one calm, dense, bench-practical tool in light and dark themes. It uses the Bench Intake Design System's tokens, components and content rules, so that every screen states things in bench language and shows provenance only on demand.

## Requirements

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

Screens SHALL use bench language and InvenTree nouns. These internal values SHALL appear only when debug mode is on, in a marked debug block or the screen's Debug panel, and never inline in normal content: IDs, digests, revisions, versions, actor identities and raw state codes. InvenTree record numbers and links are operator-facing and are not internal values. Uncertainty SHALL be described in words ("Likely — check", "Sources disagree"), never as a percentage.

#### Scenario: No internal identifiers inline

- **GIVEN** a Capture evidence tile and a Review lot with debug mode off
- **WHEN** they render normally, and when the evidence viewer is opened
- **THEN** no evidence ID, original digest, revision number or actor UUID is shown

#### Scenario: Identifiers in debug mode

- **GIVEN** the same tile and lot with debug mode on
- **WHEN** they render
- **THEN** the evidence ID, digest, revision and actor appear in marked debug blocks, set apart from the operator content

### Requirement: Limits stated once

Each limit (test InvenTree target, unverified agents, unavailable feature) SHALL be stated once, in its owning place: the connection details, Agent settings, a disabled-feature box or the Changes footer.

#### Scenario: Test target stated once

- **GIVEN** the connected target is the owned fake
- **WHEN** the operator moves through Capture, Review and Changes
- **THEN** only the connection status and the Changes footer and outcome strip name the test target; no page repeats a disclaimer footer.

### Requirement: Masthead and electronics current in both themes

The masthead SHALL be one bar with the electronics current placed by the operator's masthead style: in the bar (option A, the default), behind the whole window (option B), or in a band at the top of the page that fades down (option C). Every style SHALL follow the theme setting. The current SHALL keep its existing behaviour in every style: WebGL 2 detection, lazy loading, reduced-motion still frame, pointer stir, LED pulse and display cycling. It SHALL have a dark finish (outline, crease and fill tints) used under the dark theme, with outlines at least 3:1 against the masthead ground.

- In the bar (A), the bar carries the dotted masthead ground and parts show only in the gap between the bar's text; at compact width, where the gap is small, parts under the text dim to a quarter strength instead of disappearing, as today.
- Behind the whole window (B), the dotted masthead ground covers the window and the current stays fixed to the viewport. The bar is a translucent, blurred surface with a bottom rule. Cards are raised with the elevated shadow. Each heading, and any other text, that sits directly on the field has a patch of the masthead ground behind it, so parts pass behind the patch rather than the text.
- Fading down (C), the dotted ground and the current fill a band at the top of the page that is fully visible to 140px and fades to the page background by 420px, scrolling away with the page. The bar has no ground or rule of its own. Within the bar's height, parts follow the same text-gap rule as In the bar; below the bar, parts stay out of the main content column, so page headings, navigation and leads in the band never have parts behind them.
- Part density SHALL follow the area the current covers, so a whole-window field is no denser than the bar, within a fixed upper limit on parts.

#### Scenario: Dark masthead

- **GIVEN** the dark theme, the In the bar style and a window wider than the compact breakpoint
- **WHEN** the masthead renders with WebGL 2 available
- **THEN** the parts use the dark finish on the dark masthead ground, remain visible, and never overlap header text.

#### Scenario: Default style is unchanged

- **GIVEN** a device with no stored masthead style
- **WHEN** any screen renders
- **THEN** the masthead uses the In the bar style, exactly as before this change.

#### Scenario: Behind the whole window

- **GIVEN** the Behind the whole window style on a 1440 × 900 window with WebGL 2 available
- **WHEN** the Batches screen renders and the operator scrolls
- **THEN** the dotted ground and parts fill the window behind the content and stay in place while content scrolls; the bar is translucent; cards show the elevated shadow; and the "Batches" heading sits on a ground patch, so it keeps at least 4.5:1 contrast whatever part passes behind it.

#### Scenario: Behind the whole window in the dark theme

- **GIVEN** the Behind the whole window style and the theme setting Dark
- **WHEN** any screen renders with WebGL 2 available
- **THEN** the dark masthead ground fills the window, the parts use the dark finish with LEDs and displays still glowing, and the heading patches use the dark ground.

#### Scenario: Headings inside surfaces get no patch

- **GIVEN** the Behind the whole window style
- **WHEN** a card heading or the batch header's title renders
- **THEN** it shows no ground patch, because it already sits on a surface.

#### Scenario: Compact width keeps its dimming

- **GIVEN** a 390px-wide window, the In the bar or Fading down style, and either theme
- **WHEN** the masthead renders with WebGL 2 available
- **THEN** parts in the bar's gap show at full strength and parts under the bar's text show at a quarter strength, as In the bar does before this change, and Fading down draws no parts behind page text below the bar.

#### Scenario: Fading down

- **GIVEN** the Fading down style on Settings, in a window wider than the compact breakpoint, where the title, nav and section lead sit within the band
- **WHEN** the screen renders and then scrolls down past 420px
- **THEN** the band shows the dotted ground and parts behind the bar and in the side margins, fades to the page background by 420px, no part is drawn behind the bar's text or the page's text, and the band scrolls away with the page.

#### Scenario: No WebGL 2 or reduced motion

- **GIVEN** any style, in a browser without WebGL 2, or with reduced motion requested
- **WHEN** the screen renders
- **THEN** the style's ground, bar and card treatment still apply; without WebGL 2 no parts are drawn and three.js is not downloaded; with reduced motion the parts show as a still frame.

#### Scenario: Style changes in place

- **GIVEN** the current running in one style
- **WHEN** the operator picks another style
- **THEN** the new style applies without a page reload, the previous canvas and its parts are released, and no second animation loop keeps running.

### Requirement: Vacuum tubes in the electronics current

The electronics current SHALL include an octal vacuum tube, a 5U4 rectifier and a Nixie tube among its drifting parts, re-tinted with the theme like the existing parts.

- The glass tubes SHALL show their internal structure through translucent glass, with a warm heater glow.
- The Nixie tube SHALL count 0–9 on stacked numerals, with the lit numeral drawn thicker and never hidden by the unlit ones.

#### Scenario: Nixie numeral stays readable

- **GIVEN** a Nixie tube in the current
- **WHEN** its count moves to the next numeral
- **THEN** exactly that numeral is lit and drawn thick, and every other numeral stays thin and unlit.

#### Scenario: Tubes in the dark theme

- **GIVEN** the dark theme
- **WHEN** a tube is in the current
- **THEN** it uses the dark finish like the existing parts.

### Requirement: Solder wick with a hanging loose end

The electronics current SHALL include a solder wick dispenser. Its loose end SHALL hang under gravity from the rim, follow the dispenser as it moves and turns, react to the pointer, and be released with its dispenser.

#### Scenario: Loose end hangs and follows the dispenser

- **GIVEN** a solder wick dispenser in the current
- **WHEN** it drifts and turns, or the pointer passes over its loose end
- **THEN** the end stays attached to the rim at its fixed length, swings and settles under gravity, and keeps finite positions.

#### Scenario: Loose end leaves with its dispenser

- **GIVEN** a dispenser leaving the masthead, or the masthead unmounting
- **WHEN** the dispenser is recycled or the current is disposed
- **THEN** its loose end is removed from the scene and its geometry is released.

#### Scenario: Still frame

- **GIVEN** reduced motion
- **WHEN** the masthead renders its still frame
- **THEN** the loose end hangs straight down from the rim.

### Requirement: Token-driven layout and type

Every spacing, radius, shadow, type, motion, layer, breakpoint, opacity and fixed-size value used by a component SHALL come from a design-system token where one exists. Component styles MUST NOT contain a literal equal to a token meant for that property. The exceptions in design D11 stay local: values with no token, `calc()` of a token, grid track widths, annotated allows, the scene palette and photo masks.

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

### Requirement: Components carry the design system's names

Each shared component SHALL have its design-system name, in a file named after its main export, and there SHALL be one component per name. A screen SHALL NOT keep its own copy of a library component under another name. Where the app's name for a screen or tab is established in these specs, such as Changes, the design system SHALL use it.

#### Scenario: One component per name

- **GIVEN** the design system's ActivityIndicator, QuestionCard and SessionChat
- **WHEN** a reader looks for each in `frontend/src/components`
- **THEN** each is one component of that name, in a file of that name, used by every screen that shows it, and no other component has the same name.

### Requirement: Layout follows the design's widths and breakpoints

Main content SHALL be at most 1240px wide (1500px for Review and Records), centred. Layouts SHALL change only at the design system's named breakpoints. At phone width the masthead SHALL stay one row, and below `bp-compact` (760px) every interactive control SHALL have a hit area of at least 44px.

#### Scenario: Wide screen

- **GIVEN** a 1920px-wide window
- **WHEN** Capture and then Review render
- **THEN** Capture's content is 1240px wide and Review's 1500px, both centred.

#### Scenario: Phone width

- **GIVEN** a 390px-wide window with the connection status shown
- **WHEN** the masthead and the Capture actions render
- **THEN** the masthead is one row, nothing scrolls horizontally, and each control's hit area is at least 44px.

### Requirement: AI mark at agent touchpoints

The AI sparkle (`AiMark`, `ai` on `ai-weak`) SHALL mark the places where the operator meets an agent: the activity chip, the Agents page and Agent settings, session drawer headers, live agent lists (Proposed lots, Agent sessions) and every free-text Ask, Tell or Instructions box. Per-field Ask buttons don't carry it. It SHALL NOT mark proposed values, source chips, pills, counts or table rows. It SHALL centre on its label and be hidden from assistive technology, since the label names the agent. Pills SHALL NOT use a sparkle glyph; New uses ＋.

#### Scenario: Marked once per touchpoint

- **GIVEN** Review › Map with the Tell Examine box, and a Part record screen with per-field Ask buttons
- **WHEN** they render
- **THEN** the Tell Examine box carries the mark, and none of the Part's values, source chips or per-field Ask buttons do

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

### Requirement: Disabled controls explain themselves

`DisabledFeature` SHALL wrap any deferred control (checkbox, select, stepper, text field or button) and render it with `aria-disabled="true"` so it stays focusable. It SHALL ignore activation and input, send no request, and link a one-line explanation through `aria-describedby`.

#### Scenario: A disabled select can be focused

- **GIVEN** a disabled select wrapped in `DisabledFeature`
- **WHEN** the operator tabs to it and presses Enter
- **THEN** it takes focus, the explanation is announced, nothing opens and no request is sent

### Requirement: Descriptions with InvenTree's limits

Wherever a record has an InvenTree description (Part, category, company, manufacturer part, supplier part, parameter template, stock location, location type), screens SHALL show it with its source and a character count against InvenTree's limit: 500 for companies, 250 for the rest. Stock items SHALL show no description. A description over its limit SHALL show the count in the bad tone. A proposed description over its limit SHALL NOT be written and SHALL show the existing "Not supported yet" state; an existing InvenTree description is shown but doesn't block, because the app doesn't write it. Descriptions the app can't yet store or read SHALL render as disabled fields with an explanation.

#### Scenario: Count against the limit

- **GIVEN** a company description of 71 characters
- **WHEN** it renders
- **THEN** it shows "71 / 500" with its source chip

## MODIFIED Requirements

### Requirement: Masthead and electronics current in both themes

The masthead SHALL be one bar with the electronics current placed by the operator's masthead style: in the bar (option A, the default), behind the whole window (option B), or in a band at the top of the page that fades down (option C). Every style SHALL follow the theme setting. The current SHALL keep its existing behaviour in every style: WebGL 2 detection, lazy loading, reduced-motion still frame, pointer stir, LED pulse and display cycling. While the device's "Animate the electronics" switch is off, the current SHALL show a still frame in the chosen style, with no pointer stir, LED pulse or display cycling, and SHALL resume from that frame when the switch is turned on. It SHALL have a dark finish (outline, crease and fill tints) used under the dark theme, with outlines at least 3:1 against the masthead ground.

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

#### Scenario: Animation switched off

- **GIVEN** any style, with WebGL 2 available and "Animate the electronics" off
- **WHEN** the screen renders and the operator moves the pointer over the masthead
- **THEN** the style's ground and parts show as a still frame, nothing stirs, pulses or cycles, and turning the switch on resumes the same parts from where they stopped, unless the operating system asks for reduced motion.

## ADDED Requirements

### Requirement: Page sections are evenly spaced

Every page SHALL lay out its top-level sections (banners, scope bars, toolbars, filters, grids and cards) with the design system's page gap from one shared layout rule, so no two sections touch and no section adds its own outer margin. A section that is absent SHALL leave no gap behind.

#### Scenario: Banner and filters on Review › Lots

- **GIVEN** Review › Lots on a target that can't add stock
- **WHEN** the page renders
- **THEN** the "Adding stock isn't available…" banner, the Workspace/Table toolbar, the filter chips and the lot columns are each separated by the page gap.

#### Scenario: Every page at two widths

- **GIVEN** each batch tab and step page, Batches, Agents and every Settings section
- **WHEN** they are captured at 1440 px and 390 px wide
- **THEN** no adjacent sections touch, and the spacing between sections matches the page gap.

### Requirement: Selected rows show their whole border

A selected or current row SHALL show its full border on every side, including the first row of a list whose rows share dividers.

#### Scenario: First record selected

- **GIVEN** Review › Records listing Parts, with the first Part selected
- **WHEN** the list renders
- **THEN** the selected row's accent border shows on all four sides, and the unselected rows keep their dividers.

### Requirement: Reads load without shifting the page

A page SHALL show a skeleton in its layout when nothing is cached, and SHALL show cached data at once when it has some, refreshing it in the background. No loading or verifying message SHALL appear and disappear in the page's flow; failures keep the existing "Status unavailable" banners.

#### Scenario: Returning to Review

- **GIVEN** Review was opened earlier in the session
- **WHEN** the operator returns to it and the refresh takes 200 ms
- **THEN** the cached page shows at once, no banner appears, nothing moves, and commands become available when the refresh lands.

#### Scenario: First visit

- **GIVEN** a batch's Processing has never been read in this session
- **WHEN** it opens
- **THEN** a skeleton of the Processing layout shows until the read lands, rather than "Reading retained processing state…".

### Requirement: Refresh progress takes no space

A refresh SHALL show nothing until it has taken 400 ms, then a thin progress line under the masthead that takes no layout space. A refresh taking over 3 s SHALL add a short "Updating…" status in the page header without moving the content below it.

#### Scenario: Slow refresh

- **GIVEN** a refresh that takes 5 s
- **WHEN** the operator waits
- **THEN** the progress line appears after 400 ms and the page header says "Updating…" after 3 s, without moving the content below it.

#### Scenario: Reduced motion

- **GIVEN** an operating system set to reduce motion
- **WHEN** a skeleton or the progress line shows
- **THEN** it is still, and the loading state is still announced to assistive technology.

### Requirement: Times say which day

Every time shown for an event SHALL say which day it was: "Today 13:35", "Yesterday 23:56", or a weekday and date such as "Fri 20 Nov · 21:09" for older events, with the year added outside the current year. Times SHALL follow the device's 12- or 24-hour setting, in one format across the app, with the full date and seconds on hover and to assistive technology.

#### Scenario: A failure from days ago

- **GIVEN** a session that failed on Friday 20 November at 21:09, viewed on Monday 23 November
- **WHEN** the Agents page lists it
- **THEN** it reads "Fri 20 Nov · 21:09", and hovering shows the full date and seconds.

#### Scenario: Same format everywhere

- **GIVEN** a session step at 13:34:15 today
- **WHEN** it appears in the drawer's timeline and on the Agents page
- **THEN** both read "Today 13:34" in the device's clock format.

### Requirement: One set of state words

Agent sessions, Processing steps and the masthead SHALL describe work with one set of states, each with its own glyph so colour is not the only cue: Working, Waiting for you, Queued, Paused, Done, Failed and Not started. A lot's own review state SHALL stay separate from these.

#### Scenario: A finished session and its step

- **GIVEN** a Research session that finished and its step with no work left
- **WHEN** the session list, the step tab, the overview and the activity popover show them
- **THEN** each says Done with the same glyph, and none says Finished, Ready or Retained work.

### Requirement: Explanations behind help buttons

Explanations of how the app works SHALL sit behind a help button beside the heading or control they explain, in plain words, rather than as standing text under it. Text that only matters to developers SHALL show only in debug mode.

#### Scenario: Research lanes

- **GIVEN** the Research step page
- **WHEN** it renders
- **THEN** "One research lane per account…" is not shown under the heading, and the help button beside "Research" explains in plain words how many lots research at once.

### Requirement: Popovers open at their control

A popover SHALL open aligned to the control that opened it and stay within the window. A row that leads with a pill or glyph SHALL keep it in its own column, so its text wraps beside it.

#### Scenario: Needs you from the batch header

- **GIVEN** a batch header with "2 need you"
- **WHEN** the operator opens it
- **THEN** the popover opens under that button, and "Choose an existing Part or start a new one" wraps beside its pill rather than under it.

### Requirement: Searchable picker for records and growing lists

A choice from InvenTree records, from a list that grows with the batch, or one that allows a typed exact value SHALL use the searchable picker, the same component as Capture's batch settings, not a native menu.

#### Scenario: A record choice

- **GIVEN** a field choosing a category, location, company, Part, parameter template or another lot
- **WHEN** it renders
- **THEN** it is the searchable picker, with search.

### Requirement: Short fixed choices follow a guideline

For a short fixed list, the control SHOULD be chosen case by case and the design system SHALL document the guideline with examples: a segmented control usually suits two to four short options that fit on one line at phone width; a styled native select usually suits longer fixed lists or tight spaces.

#### Scenario: A short fixed choice

- **GIVEN** a choice between "Counted" and "Estimated"
- **WHEN** it renders
- **THEN** it may be a segmented control or a native select, as its screen suits; the guideline suggests the segmented control.

### Requirement: Settings nav lets the electronics show through

Behind the whole window, the Settings nav and its idle links SHALL have no background, so the parts show around them; each link's words SHALL have a snug backing of the masthead ground. Hover and the current section or subsection SHALL keep their full fill. Nav text SHALL keep at least 4.5:1 contrast in both themes whatever passes behind, and touch targets SHALL be unchanged.

#### Scenario: Idle, hover and current

- **GIVEN** the Behind the whole window style and Settings › Agents open
- **WHEN** the operator hovers "InvenTree"
- **THEN** the nav column has no background, idle links show only a backing behind their words, "InvenTree" shows the full hover fill and "Agents" the current fill.

#### Scenario: Dark theme

- **GIVEN** the same style with the theme setting Dark
- **WHEN** Settings opens
- **THEN** the word backings use the dark masthead ground, and every nav state keeps at least 4.5:1 contrast.

#### Scenario: Other masthead styles

- **GIVEN** the In the bar style
- **WHEN** Settings opens
- **THEN** the nav looks as it does today, on the plain page.

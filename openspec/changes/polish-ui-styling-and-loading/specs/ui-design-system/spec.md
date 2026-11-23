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

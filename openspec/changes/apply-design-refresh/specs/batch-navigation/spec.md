# Capability delta

## MODIFIED Requirements

### Requirement: Four batch tabs

The batch header SHALL show the tabs Capture, Processing, Review and Changes on their own row under the batch title, each with at most one count from retained reads: the thing to act on in its attention tone when there is one, otherwise the total. Two exceptions: Processing shows no count when it has no open questions, and Review always shows lots to check as a plain count, because its sub-tabs carry the record decisions. Approve and Results SHALL no longer be tabs.

#### Scenario: Header on any tab

- **GIVEN** a batch with 3 open questions, 8 lots to check, 3 record decisions and 6 lots ready to add
- **WHEN** any batch tab is open
- **THEN** the tabs read Capture with no count, Processing "3" in the warning tone, Review "8" as a plain count (its sub-tabs carry the decisions) and Changes "6" in the ready tone, and no tab shows a phrase or two badges.

### Requirement: Second tab row

Processing, Review and Changes SHALL each show their sub-views as a second row of tabs inside the header band, left-aligned with the batch title. Each main tab and sub-tab SHALL show one count at most, following the table in design D3: usually the thing to act on in its attention tone when there is one, otherwise the total or progress ("8", "7/12"). Capture and Overview SHALL show none; Processing, Review › Map and Changes › Added SHALL show none when they have nothing to act on; and Review keeps the plain lots-to-check count. Step sub-tabs SHALL show their status as an icon (spinner while running, ✓ when done):

- **Processing:** Overview · Examine · Research · Images · Inventory.
- **Review:** Lots · Map · Records.
- **Changes:** Ready to add · Added.

Segmented controls SHALL be used only for different views of the same list (Workspace | Table, By type | Tree), never for separate screens.

#### Scenario: Hidden screen is noticed

- **GIVEN** Review with 3 record decisions pending
- **WHEN** the operator is on Review › Lots
- **THEN** the second row shows Records with a "3" warning count without opening it.

#### Scenario: One count per tab

- **GIVEN** Review has 8 lots to check and 3 record decisions
- **WHEN** the batch header renders
- **THEN** the Review tab shows one count, and no tab shows two badges or a phrase such as "8 to check"

## ADDED Requirements

### Requirement: Calm batch header

The batch tabs SHALL sit on their own row under the batch title, left-aligned with it. The summary beside the title SHALL be short ("12 lots · 6 ready to add"). The need-you total SHALL appear once, on the batch header's "N need you" pill; the owning tab badges remain, and the masthead activity chip and the Processing › Overview sub-tab SHALL NOT repeat counts. Inside a batch, the masthead breadcrumb SHALL read "Batches" only, and the activity chip SHALL NOT repeat the batch title. Outside a batch it names the batch it shows. On app pages the breadcrumb names the page ("Batches / Agents"). The activity details SHALL link to the Agents page.

#### Scenario: Batch title appears once

- **GIVEN** the operator is on any tab of a batch
- **WHEN** the page renders
- **THEN** the batch title appears only as the batch header's heading, and "need you" counts appear only on the pill and the owning tab badges

### Requirement: Phone header

At phone width the masthead SHALL hold the brand, the development badge in development builds, an agents status button and a menu button carrying a connection status dot, each with at least a 40px target. The agents status button shows the AI mark, a spinner while work runs and one segment per step, and opens the activity details. The menu holds Agents, Settings, the server details with Open InvenTree, and theme. When the page scrolls, the batch title SHALL condense to one sticky row (back, title, need-you count, compact status button, menu), with the sub-tabs kept below it.

#### Scenario: Status stays reachable while scrolled

- **GIVEN** a 390px viewport on Processing with agents running
- **WHEN** the operator scrolls down the page
- **THEN** the condensed row shows the status button and need-you count, both operable, with no horizontal page scroll

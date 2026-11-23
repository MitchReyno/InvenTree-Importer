## MODIFIED Requirements

### Requirement: Processing overview

Processing › Overview SHALL show:

- progress per step from retained step state, never a single percentage, as one bar with each step's count linking to its step page;
- a table of lots with each step's state for that lot, linking to that step for the lot, in place of a separate list repeating the step states;
- every agent session for the batch, with its step, subject, state and latest status line;
- Needs you: everything the batch header counts as needing the operator, agent questions first and oldest first, each tagged with the tab that owns it and, for a question, its step and the assumption in use;
- an instruction field for the whole batch;
- recent activity.

It SHALL NOT list lots as an editing surface, and it SHALL NOT repeat the Review and Changes counts that the tabs already show.

#### Scenario: Overview with running agents

- **GIVEN** a batch with running Research and Images sessions and two open questions
- **WHEN** Overview opens
- **THEN** each session shows its latest status line, both questions show their assumptions, and no "Elsewhere in this batch" card repeats the tab counts.

#### Scenario: Instruction reaches the agents

- **GIVEN** a batch with one running session and one finished session
- **WHEN** the operator changes the batch instruction
- **THEN** the running session receives it while it works, the finished session is woken to apply it, and a failed delivery says so while the instruction stays saved.

#### Scenario: Needs you agrees with the header

- **GIVEN** no open agent questions and two Review decisions, so the batch header says "2 need you"
- **WHEN** Overview opens
- **THEN** Needs you lists the two decisions tagged Review, each opening it, and does not say "No open questions".

#### Scenario: Each step's state once

- **GIVEN** a batch of three lots at different stages
- **WHEN** Overview opens
- **THEN** the bar shows each step's count once, the lot table shows each lot's Research, Images and Inventory state as state pills, and no other card repeats them.

#### Scenario: Truncated Needs you

- **GIVEN** more items need the operator than the attention read lists
- **WHEN** Overview's Needs you renders
- **THEN** it says how many more there are, as the header popover does, rather than implying the list is complete.

## ADDED Requirements

### Requirement: Step pages count their own step

A step page's summary SHALL count only that step: the distinct lots its jobs cover, and its sessions, using the same rules as the step's section below it. Examine, which runs once for the whole batch, SHALL count lots formed. Counts across the batch stay on the Overview.

#### Scenario: Research page counts

- **GIVEN** a batch where Examine, Research and Images each have one finished job
- **WHEN** the Research step page opens
- **THEN** its summary reads "Research · 1 lot · 1 done", not "3 ready".

### Requirement: Step pages can focus one lot

A step page SHALL accept a lot to focus in its address, so the Overview's lot table can link to that step for that lot, and SHALL scroll to and highlight that lot's output, including on a direct load.

#### Scenario: Open a lot's Research from the table

- **GIVEN** the Overview lot table
- **WHEN** the operator opens GE S2CN1 diodes' Research pill, or loads that address directly
- **THEN** the Research page opens with that lot's output in view and highlighted.

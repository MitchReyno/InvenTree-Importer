# processing-workspace Specification

## Purpose

Processing shows the work agents are doing and what needs the operator, organised by step. Every step page follows one pattern, so step outputs, questions and sessions are always found in the same places.

## Requirements

### Requirement: Processing overview

Processing › Overview SHALL show:

- progress per step from retained step state, never a single percentage;
- every agent session for the batch, with its step, subject, state and latest status line;
- Needs you: open questions, oldest first, each with its step and the assumption in use;
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

### Requirement: Step page pattern

Each step page SHALL show the step's outputs: readings, sources, crops or matches. Corrections on the page apply to every lot that used that output. The page SHALL also show the step's questions and its sessions, with a session drawer that holds the status timeline, the open question and chat. Step pages SHALL link values to Review and evidence to Capture rather than editing lots themselves.

#### Scenario: Correct a reading

- **GIVEN** Examine shows a handwriting reading used by one lot
- **WHEN** the operator corrects it
- **THEN** the correction shows as “Your edit”, the affected lot is marked for re-examination, and other lots are unchanged.

#### Scenario: Session drawer

- **GIVEN** a running session on a step page or the Overview
- **WHEN** the operator opens it
- **THEN** a drawer shows its status timeline, its open question and a chat, and closing it returns to the page.

### Requirement: Works before agent sessions exist

Until session contracts from `simplify-intake-entry` are available, Processing SHALL present the retained jobs, questions and proposals of the current profiles in the same Overview and step structure. A step that has no data SHALL say so, rather than fabricating sessions or progress.

#### Scenario: Fixture profile

- **GIVEN** the synthetic fixture profile with reading and identifying jobs
- **WHEN** Processing opens
- **THEN** Overview lists those jobs and questions, and the Examine step page shows their outputs; no session drawer claims a live agent.

### Requirement: Pause and resume agent work

Processing, and each batch group on the Agents page, SHALL offer Pause all for that batch's agent sessions, and the Agents page's summary SHALL offer Pause all agents for every batch at once; each SHALL offer Resume once paused. Pausing SHALL stop the batch's sessions from starting new work, and SHALL NOT cancel a session, discard a queued answer or message, or change any retained output. A paused session SHALL show as paused, and Resume SHALL continue each session from where it stopped. A failed pause or resume SHALL say so and leave the previous state shown.

#### Scenario: Pause keeps queued answers

- **GIVEN** a batch with two running sessions and an answer queued for one of them
- **WHEN** the operator chooses Pause all and then Resume
- **THEN** both sessions show as paused with no new work started, nothing is cancelled, and after Resume the queued answer is delivered and both sessions continue.

#### Scenario: Pause every batch from Agents

- **GIVEN** running sessions in two batches
- **WHEN** the operator chooses Pause all agents on the Agents page
- **THEN** every session in both batches shows as paused with nothing cancelled, and Resume continues them all.

### Requirement: Inventory step page

Processing › Inventory SHALL follow the step page pattern. Its main column lists each lot's Part match and why, a side-by-side comparison for each open Inventory clarification about a lot (such as possible duplicate stock), built from the retained question and Review's records, and location and company matches linking to Review › Records. Fields the retained data doesn't hold SHALL read "Not known" rather than being invented.

#### Scenario: Duplicate stock question

- **GIVEN** Inventory asked whether a tube is existing stock #1712
- **WHEN** the operator opens Processing › Inventory
- **THEN** the comparison shows this batch's Part, location and quantity, and the InvenTree record's fields read "Not known" until questions carry the existing record (BI-015)

### Requirement: Inventory session drawer

The Inventory step page's session drawer SHALL show the selected Inventory session's timeline, its open question with Answer, and the message box. The question's option cards SHALL show disabled, explaining that questions don't carry the session's options yet (BI-015), and the answer SHALL go through the free-text answer form below them.

#### Scenario: Answer from the drawer

- **GIVEN** the duplicate stock question open in the drawer
- **WHEN** the operator writes "Different tube: add new stock" in the answer form and sends it
- **THEN** the answer is sent through the existing question path and the question leaves Needs you, while the option cards above it stay disabled

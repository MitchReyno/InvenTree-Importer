# Capability delta

## MODIFIED Requirements

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

## ADDED Requirements

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

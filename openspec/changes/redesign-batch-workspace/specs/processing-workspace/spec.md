# Capability delta

## Purpose

Processing shows the work agents are doing and what needs the operator, organised by step. Every step page follows one pattern, so step outputs, questions and sessions are always found in the same places.

## ADDED Requirements

### Requirement: Processing overview

Processing › Overview SHALL show:

- progress per step from retained step state, never a single percentage;
- every agent session for the batch, with its step, subject, state and latest status line;
- Needs you: open questions, oldest first, each with its step and the assumption in use;
- an instruction field for the whole batch;
- recent activity;
- links to Review and Changes with their counts.

It SHALL NOT list lots as an editing surface.

#### Scenario: Overview with running agents

- **GIVEN** a batch with running Research and Images sessions and two open questions
- **WHEN** Overview opens
- **THEN** each session shows its latest status line, both questions show their assumptions, and “8 lots ready to check” links to Review.

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

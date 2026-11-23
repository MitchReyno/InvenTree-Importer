## ADDED Requirements

### Requirement: Stage rows in workflow details

On desktop the workflow details SHALL be wide enough for one row per Processing stage of a batch, and on a phone a full-width sheet. Each row SHALL link to that stage's step page and show its state, a count where the stage has one (lots ready of the batch's lots; Examine shows lots formed and open questions), and a short status line: the newest status line of a session active on that stage, with its time, or otherwise a plain reason such as "Starts when Research and Images finish a lot".

#### Scenario: Stage rows for a working batch

- **GIVEN** Examine waiting on two questions, Research running on 7 of 12 lots, Images on 9 of 12 and Inventory queued
- **WHEN** the operator opens the workflow details
- **THEN** four rows read "Examine · 12 lots formed · 2 questions · Waiting for you", "Research · 7 of 12 lots · 2 working", "Images · 9 of 12 lots · 1 working" and "Inventory · 0 of 12 lots · Queued", each with its status line, and choosing a row opens that step's page.

#### Scenario: No count for a stage

- **GIVEN** a stage whose step counts are not in the read
- **WHEN** its row renders
- **THEN** it shows its known state and status line with no invented count.

### Requirement: Stage bar states

Each stage's bar SHALL show one of: done, working, waiting for you, paused, queued, not started or failed, each distinguishable without colour alone. A counted stage SHALL fill to its ready share; one in progress without a count SHALL tint its whole bar rather than show an invented share. A stage that has made progress but waits for the operator SHALL NOT look unstarted. A paused batch SHALL say Paused and offer Resume.

#### Scenario: Examine waiting on questions

- **GIVEN** the Examine lead session formed lots and is waiting on two open questions, with no stage running
- **WHEN** the masthead chip and the workflow details render
- **THEN** Examine's bar is amber and still, labelled waiting for you, and no bar animates.

#### Scenario: Paused batch

- **GIVEN** a batch paused while Research and Images were part-way, with Research's turn still running and no Images turn running
- **WHEN** the workflow details render
- **THEN** Images shows the paused hatching filled to its ready share without animation and its row says Paused, Research stays working until its turn finishes, and the batch offers Resume.

### Requirement: Only working stages animate

A stage's bar SHALL animate only while an agent is working on that stage now; waiting, paused, queued, done and failed bars SHALL be still. The animation SHALL stop under reduced motion.

#### Scenario: Reduced motion

- **GIVEN** an operating system set to reduce motion and a stage being worked on
- **WHEN** the bars render
- **THEN** the working bar is still and remains distinguishable as working.

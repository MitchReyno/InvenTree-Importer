## MODIFIED Requirements

### Requirement: Bounded status lines and delivered citations

A status line SHALL be one line of at most 120 characters, and the server SHALL rate-limit status lines. Proposals and questions SHALL cite only evidence and notes delivered to that session, except that a proposal MAY cite an agent-reported web page, which is not delivered evidence.

#### Scenario: Invalid outbox item

- **GIVEN** a proposal citing an evidence version not delivered to the session, or a status line over 120 characters
- **WHEN** the session submits it
- **THEN** the tool call returns a validation error the agent can correct, and nothing is published.

## ADDED Requirements

### Requirement: Structured session questions

The `ask` tool SHALL take one question: its subject, its reason, the fields it affects and 1–4 steps. Each step SHALL carry a prompt, an answer kind (choice, number or text) and the assumption the agent continues with. A choice step SHALL carry 2–6 options, each with a stable ID, a label of up to 80 characters and an optional detail of up to 160, and whether "Something else" is allowed. A number step SHALL be about one live lot.

#### Scenario: Valid choice question

- **GIVEN** a Research session unsure between ATmega328P-AU and ATmega328PB-AU
- **WHEN** it calls ask with one choice step offering both, assuming ATmega328P-AU
- **THEN** the question is stored open, the tool returns its ID, and the session keeps working.

#### Scenario: Invalid structure

- **GIVEN** an ask with duplicate option IDs, an option label over 80 characters, or a step without an assumption
- **WHEN** the tool server validates it
- **THEN** it returns a correctable validation result with issues naming the step and field, and nothing is stored.

### Requirement: Agents ask one thing at a time

The `ask` tool description and the session instructions SHALL tell the agent to ask about one thing per question, to split unrelated questions into separate asks, to use steps only for parts that belong together, and to offer options when the answer is one of a few.

#### Scenario: Instructions reach both providers

- **GIVEN** a Claude or Codex session starting on any processing step
- **WHEN** its tool list and opening instructions are built
- **THEN** both carry the one-question guidance and the `ask` schema with steps.

### Requirement: Stepped answer effects

An answer to a session question SHALL give exactly one value per step, matching that step's kind; a number step MAY carry text instead. One transaction SHALL record the answer and apply its capture effects: a number step sets the lot's quantity, keeping its basis in the answer, and the other steps are saved as one note on the question's subject, each line pairing a step's prompt with its label or text.

#### Scenario: Effects fail together

- **GIVEN** a stepped answer whose quantity edit succeeds but whose note edit is then refused
- **WHEN** the transaction runs
- **THEN** it rolls back as a whole, the lot's quantity is unchanged, the question stays open, and the refusal is reported.

#### Scenario: Note over the limit

- **GIVEN** a stepped answer whose combined note, including a number step answered in words, would exceed the capture note limit
- **WHEN** the server validates it
- **THEN** it is refused as an invalid answer naming the step, before any capture edit.

### Requirement: Stepped answers reach the session

The asking session SHALL receive one `answer` inbox item carrying each step's value, with the option ID for a picked choice, and sessions relying on the affected fields SHALL be told as for any answer. An answer SHALL name the question's current revision, attempt, input digest and expected capture revision, and a repeated submission with the same idempotency key and payload SHALL return the first answer, while a different payload under that key SHALL be refused.

#### Scenario: Choice answer delivered with its option

- **GIVEN** a running session that asked a one-step choice question
- **WHEN** the operator sends the option "ATmega328PB-AU"
- **THEN** a note records the question and "ATmega328PB-AU", and the session's next read_inbox returns the answer with that option's ID.

#### Scenario: Step value of the wrong kind or a missing step

- **GIVEN** an answer that omits a step, names an unknown option ID, or gives a number for a choice step
- **WHEN** the server validates it
- **THEN** it is refused as an invalid answer, and no capture edit, answer or inbox item is recorded.

### Requirement: Photo views are recorded

Each image delivered by `fetch_evidence` SHALL be recorded in the session's history with the evidence, version, page, region, and the delivered size and digest, in the final transaction before the image is returned. A refused or over-budget fetch SHALL NOT be recorded as a view, and an image whose view can't be confirmed as recorded SHALL NOT be returned. A view means the image was prepared for the tool response, not that the provider read it.

#### Scenario: Delivered and refused fetches

- **GIVEN** a session fetches one region successfully and then exceeds its image budget
- **WHEN** its history is read
- **THEN** it holds one photo view, for the delivered region, with the delivered dimensions.

#### Scenario: Commit outcome unknown

- **GIVEN** a fetch whose final transaction loses its commit acknowledgement
- **WHEN** the handler finishes
- **THEN** no image is returned and the budget stays reserved, and a view may exist for the withheld image.

### Requirement: Agent-reported web page sources

A proposal MAY cite a web page by URL in its top-level sources, with an optional title and the time the agent says it read it. The app SHALL show such a source as reported by the agent, with no saved copy, and SHALL NOT treat it as verified evidence. A cited URL SHALL be an absolute `https` or `http` URL of at most 2048 characters.

#### Scenario: Cited datasheet

- **GIVEN** a VM Research session that read a datasheet with WebFetch
- **WHEN** it proposes an identity citing that URL
- **THEN** the proposal is accepted without the URL counting as delivered evidence, its source chip reads "Web page" marked agent-reported, and the session page lists the URL as a web read linked to that proposal.

#### Scenario: Invalid URL

- **GIVEN** a proposal citing `file:///etc/passwd` or a URL over 2048 characters
- **WHEN** the tool server validates it
- **THEN** it returns a correctable validation result naming the source, and nothing is stored.

### Requirement: Status lines stay readable

The session instructions SHALL tell the agent to write status lines in plain words about the item, without internal IDs such as proposal, observation or attempt identifiers.

#### Scenario: Status after proposing

- **GIVEN** a Research session that has just published a proposal
- **WHEN** it reports status
- **THEN** the instructions it received ask for a line such as "Proposed GE S2CN1 diodes as a 1N4148-class switching diode", not "Proposal f067afc5 published".

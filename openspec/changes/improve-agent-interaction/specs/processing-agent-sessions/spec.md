## MODIFIED Requirements

### Requirement: Bounded status lines and delivered citations

A status line SHALL be one line of at most 120 characters, and the server SHALL rate-limit status lines. Proposals and questions SHALL cite only evidence and notes delivered to that session, except that a proposal MAY cite an agent-reported web page, which is not delivered evidence.

#### Scenario: Invalid outbox item

- **GIVEN** a proposal citing an evidence version not delivered to the session, or a status line over 120 characters
- **WHEN** the session submits it
- **THEN** the tool call returns a validation error the agent can correct, and nothing is published.

### Requirement: Bounded agent evidence images

A tool-capable VM coordinator SHALL accept `INTAKE_VM_EVIDENCE_IMAGE=preview|original`, defaulting to `preview` for an unset or empty value and rejecting unknown values at startup. In original mode a whole-page fetch of a ready JPEG or PNG SHALL deliver the exact bytes of the authorized version, including embedded metadata, up to the remaining 8 MiB run budget. Both file and inline delivery use those same bytes. Crops and PDF pages use the bounded preview in either mode.

Outside the whole-photo original mode, every image fetch_evidence returns to an agent SHALL be cut from the version's decoded page preview, be at most 2,576 px on its long edge and at most 1.25 MiB encoded. The result SHALL state the delivered width, height and scale relative to the page preview, and the per-run image budget SHALL count the delivered bytes.

#### Scenario: Large original in a lot session

- **GIVEN** preview mode and a lot session whose manifest delivers a 6144 × 8160 photo
- **WHEN** the agent fetches that evidence without a page or region
- **THEN** it receives a 1940 × 2576 image with its width, height and scale stated. The result's source reference names the original version and its SHA-256, and a proposal citing that reference is accepted.

#### Scenario: Large region of a page

- **GIVEN** an Examine session and a page preview of 6144 × 8160
- **WHEN** the agent requests a region 5000 px wide and 6000 px tall in page-preview pixels
- **THEN** it receives that region scaled to fit within 2,576 px, with the scale stated, and the cited source is the version, not the crop.

#### Scenario: Small region or small page

- **GIVEN** a region, or a lot session's page, no larger than 2,576 px on either side
- **WHEN** the agent fetches it
- **THEN** it receives it at its own size, never enlarged, with scale 1, and a later region request still uses page-preview pixels.

#### Scenario: Examine overview

- **GIVEN** preview mode, an Examine session and a page of any size
- **WHEN** the agent fetches it without a region
- **THEN** it receives an overview at most 768 px on its long edge, lossless where it fits the size cap, with its scale stated.

#### Scenario: Requested page has no preview

- **GIVEN** a version the session may fetch, whose requested page has no decoded preview
- **WHEN** the agent fetches it
- **THEN** the result refuses with `validation_failed`, grants no delivery authority, and sends no original bytes. Encrypted and undecoded versions never reach a session: a lot manifest refuses them as `media_not_ready` and Examine leaves them out.

#### Scenario: Too large at any quality, or removed meanwhile

- **GIVEN** a cut that exceeds 1.25 MiB even at the lowest JPEG quality, or evidence the operator removes while its preview is read
- **WHEN** the agent fetches it
- **THEN** the result carries metadata only, or refuses with `media_evidence_removed`; no image is sent, the budget is not charged, and no delivery authority is granted.

#### Scenario: Exact photo bytes

- **WHEN** original mode fetches a whole ready photo
- **THEN** its delivered digest matches the pinned version and its scale is 1. If its bytes exceed the remaining budget, only metadata is returned and no new citation is granted.

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

- **GIVEN** a running session that asked a one-step choice question, with fewer than 20 unread inbox items
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

### Requirement: Lot-forming calls record what they did

Each `propose_lot` outbox item SHALL record its outcome (formed, extended, suggested or unchanged) and any supplied `separation_reason`. Each `regroup` item SHALL record each move's source lot, destination lot and outcome (applied, suggested or unchanged).

#### Scenario: Determining a proposal's outcome

- **WHEN** the server classifies a lot proposal
- **THEN** it considers the label, Part, estimate and memberships applied and suggestions written. Clearing the Re-examine flag alone counts as unchanged.
- **AND** if PostgreSQL cannot store the supplied reason, the call returns a correctable validation result before writing anything.

#### Scenario: Lot kept apart

- **GIVEN** the lead session forms "10 kΩ resistor — packet B" with the separation reason "same MPN as packet A, date code 2407 vs 2341"
- **WHEN** the operator expands its history entry
- **THEN** the entry reads "Formed 10 kΩ resistor — packet B" and shows that reason, while an entry for a call that gave no reason says the reason was not retained.

#### Scenario: Suggestion only

- **GIVEN** an agent lot and an observation the operator placed in another lot
- **WHEN** the lead session extends the agent lot with that observation, and then repeats the call
- **THEN** the first entry reads "Suggested changes to" the lot and the second "Proposed no change to" it, and Capture holds one suggestion.

### Requirement: Status lines stay readable

The session instructions SHALL tell the agent to write status lines in plain words about the item, without internal IDs such as proposal, observation or attempt identifiers.

#### Scenario: Status after proposing

- **GIVEN** a Research session that has just published a proposal
- **WHEN** it reports status
- **THEN** the instructions it received ask for a line such as "Proposed GE S2CN1 diodes as a 1N4148-class switching diode", not "Proposal f067afc5 published".

### Requirement: Configurable VM evidence delivery

Tool-capable VM sessions SHALL support `INTAKE_VM_EVIDENCE_DELIVERY` with values `inline` and `file`. Unset or empty SHALL select `file`; any other value SHALL be refused before launching a turn. The development launcher and standalone relay SHALL forward the selected mode to the tool worker. Routes without VM file tools SHALL retain their existing delivery.

#### Scenario: File delivery

- **GIVEN** a tool-capable Claude or Codex VM session configured for file delivery or with an unset or empty setting
- **WHEN** an authorized image fetch succeeds
- **THEN** the guest applies the digest rules in [Guest-staged evidence matches the delivered image](../../../../specs/shared-vm-execution/spec.md#requirement-guest-staged-evidence-matches-the-delivered-image) and saves the delivered bytes in an owner-only temporary file and returns its path, source and rendition metadata, and instructions to open it with the provider's image/file tool, with no inline image bytes.
- **AND** the file is removed when the turn ends, and the response instructs the agent to fetch again on later turns and cite source metadata rather than the temporary path.

#### Scenario: Inline compatibility

- **GIVEN** a tool-capable VM session with the setting explicitly set to inline
- **WHEN** an image fetch succeeds
- **THEN** its existing inline image and staged-file metadata are returned.

#### Scenario: Refused or unavailable image

- **GIVEN** either delivery mode
- **WHEN** the fetch is refused or returns metadata only
- **THEN** no file is created and the result is unchanged.
- **AND** a digest mismatch or failed file write returns no successful file result.

#### Scenario: Oversized inline image becomes a bounded file result

- **GIVEN** a delivered image whose base64 representation exceeds the Codex frame limit
- **WHEN** file mode stages it
- **THEN** the returned metadata and path fit the existing transport limit without losing the delivered bytes or citation metadata, including across repeated fetches.


#### Scenario: Staging cannot establish a new citation after a failed delivery

- **GIVEN** a tool-capable VM worker fetching a version outside the manifest for the first time, in either delivery mode
- **WHEN** the file write, digest check, provider-facing response write or confirmation of that write fails
- **THEN** a subsequent proposal citing that version is refused even if the prepared photo appears in history.
- **AND** a later confirmed delivery can authorize that version under the existing citation rules; a failed repeat fetch does not revoke an earlier valid delivery.

#### Scenario: Staging a legacy-format preview

- **GIVEN** a pairing that negotiated evidence release confirmation and explicitly identifies the image format as legacy
- **WHEN** the guest stages a legacy preview with page metadata and no delivered digest
- **THEN** it computes the digest of the staged preview and retains the original source citation. For a legacy original it verifies the source digest. A modern rendition with missing or malformed required digest metadata is refused.

### Requirement: Answered questions report their answer and delivery

Within the budget of "Answer summaries fit the snapshot", the Processing read SHALL return, with each answered question, when it was answered, a bounded summary of each step's answer, the answer's capture effects and, for a session question, whether the session has acknowledged the answer in its inbox and when. A read time SHALL come from the acknowledgement that first reached the answer; one acknowledged before read times were kept SHALL be read with no time.

#### Scenario: Waiting, then read

- **GIVEN** an answered `/2` question whose answer is above the session's acknowledgement cursor, in a snapshot whose answers all fit in full
- **WHEN** Processing is read, and read again after the session's read_inbox acknowledges past the answer
- **THEN** the first read gives the answer waiting with no read time, and the second gives it read at that acknowledgement's time.

#### Scenario: Earlier runner question

- **GIVEN** an answered question of an earlier runner profile, in a snapshot whose answers all fit in full
- **WHEN** Processing is read
- **THEN** it carries the answer's time and summary with no inbox delivery, and says whether the history route would serve its job now: no for a job with only runner attempts, yes for a job a later session attempt ran.

### Requirement: Answer summaries fit the snapshot

When the answers would pass the Processing snapshot's size limit, the read SHALL budget them newest first: the full answer while it fits, then its time and delivery with the values marked omitted, then no `answer` member. Every answered question SHALL keep its session-history flag in every tier. A snapshot that is too large even without answer members SHALL fail as an oversized snapshot does today.

#### Scenario: Many answers near the size limit

- **GIVEN** a retained batch near the snapshot's size limit with many answered questions
- **WHEN** Processing is read
- **THEN** the read succeeds, the newest answers carry their summaries, older ones carry only their time and delivery with values omitted, any that still don't fit carry no answer member, and every answered question keeps its session-history flag.

### Requirement: A question can name the one it replaces

An `ask` MAY name an earlier question of the same session that it replaces, while that question is unanswered. The earlier question SHALL close and the Processing read SHALL return which question replaced it.

#### Scenario: Replacing a question

- **GIVEN** an open question asking for a lot's count, which new evidence makes wrong
- **WHEN** the session asks again naming the open question as replaced
- **THEN** the earlier question closes, the read gives the new question as its replacement, and an ask naming an answered question or another session's question is refused as correctable.

### Requirement: Questions carry pictures

An `ask` MAY carry up to 5 figures in the agent's order. Each SHALL name an evidence page delivered to the session, a view (a region of the page, quarter turns and straightening of at most 15°), up to 8 marks (circle, ellipse, box, arrow, highlight or a label of at most 40 characters), a caption of at most 80 characters and why it is shown in at most 200. The app SHALL render each view from the original without changing it, and SHALL NOT burn marks into it.

#### Scenario: Valid figure

- **GIVEN** a Research session that fetched IMG_3020
- **WHEN** it asks with one figure cropping the worn suffix, turned upright, with one box and the label "Worn: B or nothing?"
- **THEN** the question is stored with its figure, and the operator's picture is rendered from the original with the box drawn over it.

#### Scenario: Invalid figure

- **GIVEN** an ask whose figure names evidence never delivered to the session, a page of a delivered PDF that the session was never given, a region outside the page, six figures or nine marks
- **WHEN** the tool server validates it
- **THEN** it returns a correctable result naming the figure and field, and nothing is stored.

### Requirement: Agents preview their pictures

An `ask` with `preview: true` SHALL validate and render its figures with their marks drawn in, return them to the agent within its image budget, and SHALL NOT store or show a question; its renders are temporary. A preview not rendered within its bounded wait SHALL return no images and a result the agent can retry.

#### Scenario: Preview then ask

- **GIVEN** an Examine session preparing a question with two figures
- **WHEN** it calls ask with `preview: true` and then without it
- **THEN** the first call returns both rendered figures with marks, stores no question and tells the operator nothing, and the second stores one question whose pictures match the preview apart from the marks being an overlay.

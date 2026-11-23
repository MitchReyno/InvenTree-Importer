## MODIFIED Requirements

### Requirement: Step page pattern

Each step page SHALL show the step's outputs: readings, sources, crops or matches. Corrections on the page apply to every lot that used that output. The page SHALL also show the step's questions and its sessions, with a session drawer that holds the status timeline, the open questions and chat. Step pages SHALL link values to Review and evidence to Capture rather than editing lots themselves.

#### Scenario: Correct a reading

- **GIVEN** Examine shows a handwriting reading used by one lot
- **WHEN** the operator corrects it
- **THEN** the correction shows as “Your edit”, the affected lot is marked for re-examination, and other lots are unchanged.

#### Scenario: Session drawer

- **GIVEN** a running session on a step page or the Overview
- **WHEN** the operator opens it
- **THEN** a drawer shows its status timeline, its open questions and a chat, and closing it with Close, Esc or a click on the dimmed page returns to the page.

### Requirement: Inventory session drawer

The Inventory step page's session drawer SHALL show the selected Inventory session's timeline, its open questions with Answer, and the message box. A question's choice options SHALL show as live option cards that answer it, as in every session drawer.

#### Scenario: Answer from the drawer

- **GIVEN** the duplicate stock question open in the drawer, offering "Same tube as stock #1712" and "Different tube: add new stock"
- **WHEN** the operator picks "Different tube: add new stock" and sends it
- **THEN** the answer is sent through the session question path with that option, and the question leaves Needs you.

## ADDED Requirements

### Requirement: Answer a question step by step

A session drawer SHALL answer a session question in place, one step at a time. A one-step question SHALL show its answer and Send. A question with several steps SHALL show "Step N of M" with Back and Next, then a check-your-answers summary where each step can be changed, and SHALL send every step in one answer. Each step SHALL show the agent's assumption until it is answered. An unsaved draft SHALL keep every step's answer under the existing pinned-draft rules.

#### Scenario: Stepped answer

- **GIVEN** an open three-step question: same Part (choice), how many left (number), where it goes (choice)
- **WHEN** the operator picks "Yes, same Part", enters 380 estimated, picks "Drawer R4", checks the summary and presses "Send 3 answers"
- **THEN** one answer is sent with all three step values, the question leaves Needs you, and focus moves to the next open question or the drawer heading.

### Requirement: Answer kinds in the drawer

A choice step SHALL show each option as a card the operator picks, and picking SHALL NOT send; where the agent allows it, "Something else…" SHALL take text instead. A number step SHALL take the quantity and whether it was counted or estimated, check the value as it is typed with a plain fix, and offer "Answer in words". A text step SHALL take up to 2048 characters.

#### Scenario: Prose in a number step

- **GIVEN** a number step
- **WHEN** the operator types "about 380"
- **THEN** the field shows "Enter just the number, like 380. Choose “Estimated” if it isn't an exact count." before anything is sent, and Next stays unavailable until the value is a number or the step is answered in words.

#### Scenario: Answer in words

- **GIVEN** a number step the operator can't count
- **WHEN** they choose "Answer in words" and write "Still sealed in the reel"
- **THEN** that step sends text, the lot's quantity is unchanged, and the session receives the words.

#### Scenario: Earlier question format

- **GIVEN** an open session question retained before this change, with one quantity or clarification prompt
- **WHEN** the drawer shows it
- **THEN** it is shown and answered as a one-step number or text question, through the earlier answer format.

### Requirement: Expandable session history

Each entry in a session's history that has more to show SHALL expand in place to its details and SHALL link to the pages it concerns. Consecutive entries of the same kind about the same subject or photo SHALL be grouped into one expandable entry. An entry with nothing more to show, such as a status line, SHALL stay one line.

#### Scenario: Grouped observations

- **GIVEN** the lead session recorded three observations in a row in one photo
- **WHEN** the drawer shows its history
- **THEN** one entry reads "Recorded 3 observations in Bench bag spill", and expanding it lists each with its crop and reading.

### Requirement: Lot-forming entries expand with links

When expanded, an observation SHALL show its crop, its reading with the source chip and its visible count, linking to the photo in Capture and the map. A lot formed or extended SHALL show the lot's current observations, quantity and basis and why it is separate, labelled as current, linking to the lot in Review and the map. A regroup SHALL show which observations moved from which lot to which, linking to each affected lot; an older regroup SHALL list its destination lots.

#### Scenario: Expand a formed lot

- **GIVEN** an entry "Formed 10 kΩ resistor — packet B"
- **WHEN** the operator expands it
- **THEN** it lists the packet front and slip line 2, "380 · estimated" and "same MPN as packet A, date code 2407 vs 2341", with Open lot in Review and Show on the map.

### Requirement: Proposal, question and failure entries expand with links

When expanded, a proposal SHALL show its proposed fields with source chips, what it relies on and whether it is current, linking to the lot in Review, the Part in Records, each source and every open question that makes it provisional (an open question on the same subject sharing one of its fields). A question SHALL show its steps and assumptions, linking to Answer and the lot. A failure or stop SHALL show its summary, linking to the failure details and, where allowed, Start fresh.

#### Scenario: Expand a proposal

- **GIVEN** a Research session's history holding "Proposed ATmega328P-AU · provisional"
- **WHEN** the operator expands it
- **THEN** it shows the MPN, manufacturer and package with their source chips and the open questions that make it provisional, with links to the lot in Review, the Part in Records and each of those questions.

#### Scenario: Linked record no longer exists

- **GIVEN** an entry about a lot that has since been retired
- **WHEN** the operator expands it
- **THEN** the details still show what the agent did, and the lot link is replaced by "Lot retired" rather than a broken link.

### Requirement: Your inputs in the session history

A session's history SHALL include the operator's inputs sent to the session, marked as theirs and placed at the time they were sent: answers with what they changed, instructions, new evidence and requests to revise. An input the session has not read yet SHALL say so. A notice the app sent, such as a lot's revised identity, SHALL be marked as the app's, not the operator's. Chat messages SHALL stay in the chat.

#### Scenario: Answer in the history

- **GIVEN** the operator answered a three-step question
- **WHEN** the session's history shows it
- **THEN** an entry "You answered: same Part · 380 estimated · Drawer R4" expands to "Lot quantity set to 380 (estimated) · note added", with a link to the lot.

### Requirement: Drawer and session page split

The session drawer SHALL show the history without individual photo views and web reads, summarising each run of them in one line such as "Viewed 14 photos · see full session", and SHALL link to the session page with "Open full session". The session page SHALL show every entry, including each photo view and web read.

#### Scenario: Summary line in the drawer

- **GIVEN** a Research session that viewed two photos and cited three web pages between two proposals
- **WHEN** the drawer shows its history
- **THEN** one line reads "Read 3 web pages · viewed 2 photos · see full session", and the session page lists all five.

### Requirement: Agent session page

Each agent session SHALL have a page inside its batch's Processing that shows the session as one conversation, oldest first:

- agent actions as compact expandable rows, grouped as in the drawer, with each photo view and web read;
- chat messages from the operator and the agent;
- questions as their cards, answered in place with the same form as the drawer;
- the operator's inputs, and a divider for each attempt, with its reason where one is retained.

#### Scenario: One conversation

- **GIVEN** a Research session that read pages, asked a question, received a chat message and a correction, and was then started fresh
- **WHEN** its page opens
- **THEN** the actions, the question card, the message, the agent's reply and the correction (as the operator's input) appear in time order within the first attempt, and a divider marks where attempt 2 started, with its reason only where the retained data records one; inputs are placed by when they were sent.

### Requirement: Session page header and panels

The session page SHALL show a header with the step and subject, provider and model, where it runs, whether web pages are allowed, and its time span from when it was first queued, and its attempts. Side panels SHALL list the photos it viewed and the sources it cited, with debug details in debug mode.

#### Scenario: Photo view on the page

- **GIVEN** a session fetched a region of a 6144 × 8160 photo
- **WHEN** the operator expands that view on the session page
- **THEN** it shows the region recut from the page as the agent was sent it, with the delivered size, digest and region, and links to the photo in Capture.

### Requirement: Reaching and reading the session page

The session page SHALL be reached from the drawer's "Open full session", the Agents page, the Processing session lists and the failure details. It SHALL update live by re-reading its newest entries on each change, keeping the older entries it has loaded without duplicates, SHALL load older entries on request and SHALL filter to messages, the operator's inputs, photos or web. A message box SHALL send to the session's inbox, as the drawer's chat does.

#### Scenario: Message from the page

- **GIVEN** a running Research session's page
- **WHEN** the operator sends "Check the Microchip PB datasheet first"
- **THEN** it appears in the conversation as theirs, reaches the session's inbox once, and the agent's reply appears below it.

#### Scenario: Answer on the page

- **GIVEN** an open choice question in the conversation, also open in the drawer
- **WHEN** the operator picks an option and sends it on the page
- **THEN** the answer is recorded once through the session question path, the drawer's form shows it answered, and an unsaved draft in the drawer is kept under the superseded-draft rules.

#### Scenario: Long history

- **GIVEN** a session with more entries than one read returns
- **WHEN** the operator reaches the oldest shown entry and chooses Load older
- **THEN** the next older entries appear above in order without duplicates, and new entries appear at the bottom when the newest entries are next re-read.

#### Scenario: Many entries between refreshes

- **GIVEN** a session page with older entries loaded
- **WHEN** more new entries arrive before the next refresh than one read returns
- **THEN** the page shows the newest entries and drops the older ones it had loaded rather than leaving a gap, and Load older continues from the newest entries shown.

#### Scenario: Session from another batch or account

- **GIVEN** a session page address for a job outside the batch or the caller's scope
- **WHEN** it is opened
- **THEN** the page says the session was not found and shows no history.

### Requirement: Failures in plain words

A failed or stopped session SHALL lead with its recorded cause in plain words, built on the server from its recorded provider error and cause code and shown without debug mode, such as "Couldn't reach Claude: the API was overloaded (HTTP 529)", with what it was doing and when. The failure category's general advice SHALL be offered once behind a help button, and codes SHALL show only in debug mode. A failure recorded before causes were kept SHALL say the cause wasn't recorded.

#### Scenario: Provider overloaded

- **GIVEN** a Research session whose turn failed with Claude error kind `overloaded` and a recorded HTTP status 529
- **WHEN** its row, drawer or page shows the failure
- **THEN** it reads "Couldn't reach Claude: the API was overloaded (HTTP 529)" with its last status line and time, the advice is behind a help button, and no code shows unless debug mode is on.

#### Scenario: Old failure without a cause

- **GIVEN** a session that failed before causes were recorded
- **WHEN** it is shown
- **THEN** it says the cause wasn't recorded instead of showing generic advice as if it were the cause.

### Requirement: Session drawer header

The session drawer's header SHALL show the session's state, model, where it ran (agent VM or host), whether web pages were allowed, its time span, "Attempt N · M earlier failed ▸" when it has retries, and Open full session.

#### Scenario: Retried session in the drawer

- **GIVEN** a Research session on its third attempt after two failures
- **WHEN** its drawer opens
- **THEN** the header reads its state, "Claude Opus 5.5 · agent VM · web on", the span "Today 13:02–13:13", "Attempt 3 · 2 earlier failed ▸" and Open full session.

### Requirement: Activity in the app's words

Processing's recent activity SHALL lead each entry with the app's recorded event in plain words, linked to its lot or record, such as "Research proposed an identity for GE S2CN1 diodes", with the agent's status line as a muted "Agent: …" note.

#### Scenario: Proposal in recent activity

- **GIVEN** a Research session that published an identity proposal for the GE S2CN1 diode lot
- **WHEN** recent activity shows it
- **THEN** the entry reads "Research proposed an identity for GE S2CN1 diodes" linking to the lot, with the agent's latest status line as a muted note in the agent's own words, and the app's text shows no internal ID.

### Requirement: Labelled message box

The message box in the session drawer and on the session page SHALL be labelled "Message <step>", with the placeholder "Ask why, or tell it what to check next" and the hint "Enter to send · Shift+Enter for a new line". Send SHALL be available once there is text.

#### Scenario: Sending a message

- **GIVEN** an empty message box for a Research session
- **WHEN** the operator types a message and presses Enter
- **THEN** it is sent once, Shift+Enter inserts a new line instead, and Send was unavailable while the box was empty.

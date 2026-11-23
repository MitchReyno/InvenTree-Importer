## MODIFIED Requirements

### Requirement: Agent-attributed lot writes stay within draft authority

The system SHALL record each agent-created observation, lot, observation link and Part link as a capture revision attributed to the agent session. Agent writes MUST NOT set counted quantities or other human-only values, approve anything, or bypass Review before inventory effects.

#### Scenario: Estimated count only

- **GIVEN** a lead session on an input earlier than `/7` proposes a lot with a count of 50
- **WHEN** the lot is created
- **THEN** its quantity is an estimated suggestion attributed to the session, and Review still requires the operator to accept or replace it before approval.

#### Scenario: Estimate from the typed output

- **GIVEN** a `/7` Examine session
- **WHEN** it proposes a lot with a count, retries without the count, and then publishes `examine-identity/1` for the created lot with a quantity estimate of 50
- **THEN** the first call is refused naming the count argument, the retry creates the lot, and the estimate of 50 reaches Review as an estimated suggestion attributed to the session that the operator must accept or replace before approval.

### Requirement: New evidence wakes the lead session

When evidence becomes ready in a batch that already has a lead session, the system SHALL deliver an evidence item to that session, resuming it if it has finished and can run on the actor's current profile; a finished `shared-vm-agent/3` lead under the cutover drain fence, or after the switch, keeps the evidence pending for the upgrade action. The session SHALL examine only the new evidence and then either add observations to an existing AI lot, form a new draft lot, or record the observation unassigned with a question. Adding an observation to a lot SHALL notify that lot's Research and Images sessions, as defined by the stage pipeline.

#### Scenario: Back of an existing tape

- **GIVEN** an AI-proposed LED lot whose Research has finished
- **WHEN** the operator adds a photo of the back of the same tape
- **THEN** the lead session records an observation on it, adds it to the LED lot, and the lot's Research and Images sessions receive a new-evidence notice, without other lots changing.

#### Scenario: Evidence for a retained `/3` lead

- **GIVEN** a finished `shared-vm-agent/3` lead on an actor whose drain fence is set, or that now serves `/4`
- **WHEN** new evidence becomes ready in its batch
- **THEN** the evidence item is delivered to the lead's inbox without resuming it, and the upgrade action carries it into the `/7` lead.

### Requirement: One Examine lead session per batch

When a batch has ready evidence that no observation covers, and no evidence has become ready for a quiet period, the system SHALL queue one Examine lead session for the batch. The default quiet period is 20 seconds. At most one lead session per batch SHALL be active or queued. It SHALL NOT start for an archived batch, or when no agent default is saved. A finished lead session SHALL be resumed, not replaced, when new work arrives for it, except a finished `shared-vm-agent/3` lead during or after the cutover drain, whose new work waits for the upgrade action to replace it with a `/7` attempt carrying its history.

#### Scenario: Photos finish preparing

- **GIVEN** a batch with six ready photos and no lots
- **WHEN** the quiet period passes after the last preview is ready
- **THEN** exactly one Examine lead session is queued for the batch, and Processing and Capture show it.

#### Scenario: More photos arrive during the quiet period

- **GIVEN** a pending quiet period
- **WHEN** another photo becomes ready
- **THEN** the quiet period restarts, and no second lead session is queued.

#### Scenario: Finished `/3` lead at cutover

- **GIVEN** a finished `shared-vm-agent/3` lead on an actor that has switched to `/4`
- **WHEN** new evidence arrives and the operator runs the upgrade action
- **THEN** the lead isn't resumed under `/3`; the upgrade replaces it with a `/7` attempt carrying its history and the pending evidence.

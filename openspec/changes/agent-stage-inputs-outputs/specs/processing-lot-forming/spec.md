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

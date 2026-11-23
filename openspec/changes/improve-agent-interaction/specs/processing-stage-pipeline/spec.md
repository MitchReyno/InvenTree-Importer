## MODIFIED Requirements

### Requirement: Non-blocking questions with assumptions

A question SHALL name the field or fields it affects and, for each of its steps, the assumption the agent is using. After asking, the agent SHALL keep working.

- A session question SHALL ask one thing. It has one step, or up to four related steps that are answered together. Each step SHALL have one answer kind: a choice among 2–6 options the agent offers, a number that is a lot's quantity, or text.
- Proposals that rely on an open question SHALL show that dependency and be labelled provisional until the question is answered.
- An agent MAY enter waiting-for-input only when no useful work remains without an answer, and SHALL say so in its status line.
- Every open question in a batch SHALL appear in one Needs you list, ordered by the time it was asked, showing its answer kind or step count and the agent's assumptions.

#### Scenario: Unclear quantity

- **GIVEN** the Examine lead session cannot tell whether a reel holds 10 or 12 parts
- **WHEN** it asks a one-step number question assuming an estimated 10
- **THEN** the question appears in Needs you as a number question assuming 10, its identity proposal and Research continue, and the quantity proposal shows as provisional on 10.

#### Scenario: Related steps in one question

- **GIVEN** the lead session is unsure whether two packets are one Part, how many are left in one, and where it goes
- **WHEN** it asks one question with three steps: a choice, a number and a choice, each with its assumption
- **THEN** Needs you shows one row, "3 steps", with the three assumptions, and no step's prompt holds another step's question.

#### Scenario: Agent asks without an assumption

- **GIVEN** a question submitted without affected fields, or with a step that has no assumption
- **WHEN** the tool server validates it
- **THEN** it is refused with a validation error, so the agent cannot block silently.

#### Scenario: Malformed steps

- **GIVEN** a question with five steps, a choice step with one option, or a number step about no live lot
- **WHEN** the tool server validates it
- **THEN** it is refused with a validation error naming the affected field or step, and no question is stored.

## ADDED Requirements

### Requirement: Step header warns of a model no longer offered

While a step's saved model is one its provider's current list no longer offers, that step's page header SHALL show the same "Not offered" pill as Settings › Agents, linking to the step's row there. The pill SHALL NOT show while the list is the built-in fallback or has never been read.

#### Scenario: Images uses a dropped model

- **GIVEN** Images saved with `claude-opus-4-6`, which Claude's current list no longer offers
- **WHEN** the operator opens Processing › Images
- **THEN** its header shows a "Not offered" pill naming the model, which opens Settings › Agents at "Provider and model per step".

#### Scenario: No list read yet

- **GIVEN** no Claude list ever read
- **WHEN** Processing › Images opens
- **THEN** no pill shows.

## ADDED Requirements

### Requirement: Dialogs close from their backdrop

A modal dialog, centred or docked as a drawer, SHALL close when the operator clicks its dimmed backdrop, exactly as Esc or its Close button would: through the dialog owner's close handling, so a guard against losing unsaved work applies the same way. A dialog whose close is disabled SHALL stay open. A press that starts inside the dialog and ends on the backdrop, such as selecting text, SHALL NOT close it.

#### Scenario: Click beside the session drawer

- **GIVEN** a session drawer open over Processing with no unsaved answer
- **WHEN** the operator clicks the dimmed page beside it
- **THEN** the drawer closes and focus returns to the session row that opened it.

#### Scenario: Unsaved answer

- **GIVEN** a session drawer holding an unsaved answer draft
- **WHEN** the operator clicks the backdrop
- **THEN** the drawer stays open and shows "Save or discard your answer before closing this session", as Close does.

#### Scenario: Close disabled or a drag out of the dialog

- **GIVEN** a dialog whose close is disabled while its work is pending, or an operator selecting text who releases the pointer over the backdrop
- **WHEN** the click reaches the backdrop
- **THEN** the dialog stays open.

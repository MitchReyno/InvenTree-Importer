# Capability delta

## MODIFIED Requirements

### Requirement: Accessible workflow disclosure and layout

The workflow control SHALL provide text equivalent to visual step segments, expanded state, keyboard operation, labelled details, Escape dismissal and predictable focus return. The masthead SHALL be one bar holding, in order: the wordmark, the Dev mode badge in development builds, the breadcrumb, the workflow activity control, connection status and Open InvenTree. Connection status, workflow activity and Open InvenTree SHALL stay distinguishable. The bar SHALL wrap responsively, and hide only the breadcrumb and the activity labels at phone width, rather than hiding essential information. The decorative electronics current SHALL be masked so that no part overlaps the wordmark, breadcrumb or status controls.

#### Scenario: Expanded workflow on a narrow screen

- **GIVEN** a 390px viewport or 200% zoom and several active jobs
- **WHEN** the workflow disclosure opens and closes by keyboard
- **THEN** all text/actions are reachable, focus returns predictably and no header content is clipped or causes document horizontal overflow.

#### Scenario: Parts never cross header text

- **GIVEN** a desktop masthead with a breadcrumb and the electronics current running
- **WHEN** parts drift across the bar
- **THEN** they are fully transparent behind the wordmark and breadcrumb and behind the status controls, and visible only in the band between them.

# Capability delta

## MODIFIED Requirements

### Requirement: Accessible workflow disclosure and layout

The workflow control SHALL provide text equivalent to visual step segments, expanded state, keyboard operation, labelled details, Escape dismissal and predictable focus return. The masthead SHALL be one bar holding, in order: the wordmark, the Dev mode badge in development builds, the breadcrumb, the workflow activity control, connection status (whose menu holds Open InvenTree) and the Settings button. Connection status and workflow activity SHALL stay distinguishable. At phone width the bar SHALL stay one row of brand, the Dev mode badge shortened to "Dev" (still announced in full), the activity control as an agents status button and a menu button carrying a connection status dot. It hides the breadcrumb and activity labels, and the menu holds Agents, Settings, the connection details with Open InvenTree, and theme, so no essential information is lost. The decorative electronics current SHALL be masked so that no part overlaps the wordmark, breadcrumb or status controls.

#### Scenario: Expanded workflow on a narrow screen

- **GIVEN** a 390px viewport or 200% zoom and several active jobs
- **WHEN** the workflow disclosure opens and closes by keyboard
- **THEN** all text/actions are reachable, focus returns predictably and no header content is clipped or causes document horizontal overflow.

#### Scenario: Parts never cross header text

- **GIVEN** a desktop masthead with a breadcrumb and the electronics current running
- **WHEN** parts drift across the bar
- **THEN** they are fully transparent behind the wordmark and breadcrumb and behind the status controls, and visible only in the band between them.

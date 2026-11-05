# Capability delta

## MODIFIED Requirements

### Requirement: Evidence-based responsive placement

Capture SHALL default to the original mockup's composition: evidence on the left, settings on the right. It SHALL remove the editable Physical lots and Part proposals panes and the persistent subject-editor chrome. It MAY show a read-only Proposed lots glance in the settings column, giving each lot's name, state and its agent's latest status line, with a link to Review. It SHALL use the design-system tokens in both themes, and keep the three evidence actions, the groups and a compact stage hierarchy. Narrow layouts SHALL reflow without horizontal overflow of the page or loss of drafts. Current requested field behaviour overrides obsolete mockup controls.

#### Scenario: Select a layout after comparison

- **GIVEN** the original Capture composition and representative synthetic content
- **WHEN** the revised view is checked at desktop, 360px/390px and native 200% zoom
- **THEN** it follows the mockup's two-column hierarchy by default, stacks accessibly on narrow screens, preserves draft/focus continuity and records any necessary deviation; no new right-versus-top layout experiment is required.

#### Scenario: Capture no longer exposes subject panes

- **GIVEN** a batch containing retained physical lots and shared Part proposals
- **WHEN** Capture opens
- **THEN** neither editable Physical lots nor Part proposals panes nor their persistent editor chrome appear, while all retained subjects and evidence links remain intact.

#### Scenario: Access editing after removing panes

- **GIVEN** a retained subject or legacy subject deep link
- **WHEN** the operator needs manual creation/editing, exact quantity correction or existing-Part choice
- **THEN** Review provides the existing scoped actions and pinned subject context; navigation honours dirty drafts and Capture evidence actions do not depend on a removed queue selection.

#### Scenario: Read-only lots glance

- **GIVEN** a batch with proposed lots
- **WHEN** Capture shows the Proposed lots glance
- **THEN** each lot shows its name, state and latest status line without any edit control, and selecting a lot opens it in Review.

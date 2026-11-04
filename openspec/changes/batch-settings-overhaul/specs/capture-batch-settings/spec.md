# Capture batch settings delta

## MODIFIED Requirements

### Requirement: One visible Batch settings panel

Capture SHALL expose one Batch settings panel with title, optional batch notes, a single Default location, supplier, prepared order context, Shared part tags and Custom instructions. It SHALL remove Quantity mode, Note relates to, Batch human note and Capture tags mode from this panel. Per-lot reviewed quantity correction SHALL remain available outside the panel. Settings SHALL use concise reusable inputs without separate settings navigation buttons.

#### Scenario: Open Capture

- **GIVEN** a retained batch with defaults and a lot-specific override
- **WHEN** Capture opens
- **THEN** one Batch settings panel exposes the simplified settings, labels inherited locations and identifies overrides without merging lots; Quantity mode is absent from the panel and per-lot reviewed quantities remain accessible.

#### Scenario: Optional batch and order notes

- **GIVEN** an editable batch with no current batch note
- **WHEN** Add batch notes is activated below the title, text is entered and then hidden
- **THEN** the multiline text autosaves and remains available on reopening; Remove retires the current text through a revision without deleting history. The prepared Add order notes control refers to separate order-scoped text, never a Part or lot note.

#### Scenario: Custom instructions label

- **GIVEN** retained Batch instructions
- **WHEN** the panel opens after upgrade
- **THEN** the same instructions and scope appear as Custom instructions, retaining their provenance and existing processing-consumption limitations.

### Requirement: Explicit retained settings and context

Valid editable settings SHALL autosave to retained application state with loaded-revision comparison and truthful acknowledgement, replacing the panel's normal Save/Discard controls. Supplier, date, tags, notes and default intent SHALL retain provenance and per-lot overrides. Human context and inferred values MUST NOT silently become approved effects. Calendar dates and exact quantities/PKs SHALL retain their existing string representations. Invalid drafts, conflicts and uncertain saves SHALL remain recoverable without silent rebasing or automatic command replay.

#### Scenario: Reload after acknowledged save

- **GIVEN** settings with a supplier observation, date, tags, retained exact quantities and explicit lot overrides
- **WHEN** valid edits receive autosave acknowledgement and the page reloads
- **THEN** the same values, identities and inheritance appear, saved status corresponds to the acknowledged revision, and Review distinguishes context and proposals from approved effects.

#### Scenario: Conflict or unconfirmed save

- **GIVEN** a dirty settings panel and a newer server revision or a lost acknowledgement
- **WHEN** autosave is refused or cannot be confirmed
- **THEN** local inputs remain intact and dirty navigation remains guarded; the UI exposes conflict or uncertainty and explicit reconciliation/exact retry, without automatic rebase, partial-success claim or newly keyed retry.

#### Scenario: Change a default with existing explicit overrides

- **GIVEN** an inheriting lot and an explicitly located lot or Part/group
- **WHEN** the batch default changes
- **THEN** only fallback effective locations change, overrides remain visible and affected review/processing freshness is reconciled before use.

#### Scenario: Fast edits while a save is in flight

- **GIVEN** one immutable settings request is in flight
- **WHEN** further valid edits occur before it is acknowledged
- **THEN** newer edits remain visible and unsaved until a later serialized request uses the acknowledged revision; an older response or socket refresh cannot overwrite them or mark them saved.

#### Scenario: Invalid or interrupted input

- **GIVEN** a blank required title, incomplete date or ongoing text composition
- **WHEN** the debounce or blur boundary is reached
- **THEN** invalid/incomplete input is retained with validation feedback and no invalid command is sent; composed text is not truncated by autosave.

### Requirement: Disabled purchase-order controls

Create a purchase order SHALL appear directly below supplier, disabled and greyed out with an explanation. Its future dependent order/purchase inputs SHALL be prepared as a disabled expandable preview: order/receipt number and purchase date each have Auto, None and Manual choices, Auto initially selected; manual values use text and calendar-date inputs respectively, with Add order notes revealing optional multiline notes. No preview action SHALL save active PO intent or cause a purchase-order operation. Future PO enablement is a separate change.

#### Scenario: PO controls visible but inactive

- **GIVEN** a batch with or without a supplier
- **WHEN** the operator examines Batch settings and other fields autosave
- **THEN** PO controls remain disabled and explained directly below supplier, preview visibility is controllable without enabling fields, and no settings payload can request PO creation.

#### Scenario: Preview conditional order fields

- **GIVEN** the PO preview is expanded
- **WHEN** the operator examines its inactive controls
- **THEN** Auto/None/manual number and date options and the order-notes affordance are visible with the intended conditional layout; collapsing it does not erase retained order context.

### Requirement: Evidence-based responsive placement

Capture SHALL default to the original mockup's evidence-left/settings-right composition, removing the Physical lots and Part proposals panes and persistent subject-editor chrome. It SHALL retain the approved light palette, three evidence actions, groups and compact stage hierarchy. Narrow layouts SHALL reflow without document horizontal overflow or draft loss. Current requested field behaviour overrides obsolete mockup controls.

#### Scenario: Select a layout after comparison

- **GIVEN** the original Capture composition and representative synthetic content
- **WHEN** the revised view is checked at desktop, 360px/390px and native 200% zoom
- **THEN** it follows the mockup's two-column hierarchy by default, stacks accessibly on narrow screens, preserves draft/focus continuity and records any necessary deviation; no new right-versus-top layout experiment is required.

#### Scenario: Capture no longer exposes subject panes

- **GIVEN** a batch containing retained physical lots and shared Part proposals
- **WHEN** Capture opens
- **THEN** neither Physical lots nor Part proposals panes or their persistent editor chrome appear, while all retained subjects and evidence links remain intact.

#### Scenario: Access editing after removing panes

- **GIVEN** a retained subject or legacy subject deep link
- **WHEN** the operator needs manual creation/editing, exact quantity correction or existing-Part choice
- **THEN** Review provides the existing scoped actions and pinned subject context; navigation honours dirty drafts and Capture evidence actions do not depend on a removed queue selection.

## ADDED Requirements

### Requirement: Connected editing and independent transport health

Settings SHALL disable and grey editable fields when the scoped application connection is unavailable, preserving drafts and uncertain requests until explicit reconciliation. Fresh authenticated HTTP fallback SHALL permit editing despite a socket failure. Target unavailability SHALL independently disable remote catalogue operations. Availability and recovery SHALL be explained beyond colour.

#### Scenario: API disconnect during a save

- **GIVEN** an edited panel with a pending or unconfirmed command
- **WHEN** the application connection becomes unavailable
- **THEN** fields are disabled, the pending state is explained and local text/request identity remain retained in the mounted session; reconnection does not blindly replay or declare success.

#### Scenario: Socket-only failure

- **GIVEN** a fresh scoped HTTP connection and unavailable live updates
- **WHEN** the app uses fallback polling
- **THEN** settings remain editable and autosave still requires HTTP acknowledgement; no second socket or socket mutation protocol is introduced.

#### Scenario: Target failure with a healthy application

- **GIVEN** the application API is healthy but the configured target is unavailable
- **WHEN** the operator edits a batch title or searches locations
- **THEN** title autosave remains available while remote search shows unavailable, preserving prior selections rather than reporting an empty catalogue.

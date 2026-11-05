# Capability delta

## Purpose

The operator can check and correct every InvenTree record a batch will create or reuse, once per record rather than once per lot. Each record shows existing against proposed values and their sources, and every edit says which lots it affects.

## ADDED Requirements

### Requirement: Records by type

Review › Records SHALL list the records the batch touches, grouped by type:

- categories;
- companies, as manufacturers and suppliers;
- Parts;
- manufacturer parts;
- supplier parts;
- parameters and parameter templates;
- locations;
- stock items;
- images and attachments;
- tags.

Each type SHALL show counts of new, existing and to-decide records. Each record SHALL show its New, Update, Exists or Choose state, existing against proposed values, a source chip per value, and the lots that use it.

#### Scenario: New company with a likely match

- **GIVEN** a retained proposal giving a Part's manufacturer as new “GCT”, with a likely match in the existing company “Global Connector Technology”
- **WHEN** Companies is opened
- **THEN** GCT shows “Needs a decision” with options to use the existing company (with the reason) or pick another; creating a new manufacturer is shown as not supported yet, and each choice states what changes.

### Requirement: Record sources

Mapped records SHALL come from capture state. Proposed-new values SHALL come only from retained structured proposals supplied by the agent work (BI-006), and none SHALL be shown before those exist. A Part with no spec yet SHALL show “Needs a decision”, with actions to choose an existing Part or start a new one.

#### Scenario: Before agent proposals exist

- **GIVEN** a batch with mapped Part specs and no structured proposals
- **WHEN** Records opens
- **THEN** it lists only mapped records and Parts needing a decision, and shows no proposed-new values.

### Requirement: Record-level edits with stated scope

The operator SHALL be able to edit a record once, and have the edit apply to every lot and Part that uses it. Every edit control SHALL state its scope (e.g. “applies to RES-0144, used by 2 lots”). Edits SHALL use the existing capture revision compare-and-set and record the operator as the actor. Reviewed lots that use an edited record SHALL read as changed since review.

#### Scenario: Map a template batch-wide

- **GIVEN** two new Parts in different categories using the existing template “Composition”
- **WHEN** the operator maps it to the existing “Resistor type”, giving a category mapping for each category
- **THEN** both Parts use “Resistor type”, the change is attributed to the operator, and any reviewed lot using those Parts reads “Changed since review”.

#### Scenario: Template with no mapping in a Part's category

- **GIVEN** a template mapping that omits one affected Part's category
- **WHEN** the operator saves it
- **THEN** the edit is refused, naming that Part, until a mapping is given or the Part is excluded.

#### Scenario: Concurrent edit

- **GIVEN** the batch revision changed since the record was loaded
- **WHEN** the operator saves a record edit
- **THEN** the save is refused with the current values shown, and the operator's draft is kept for an explicit retry.

### Requirement: Supported record edits

Record edits SHALL cover: mapping a company (in its manufacturer or supplier role) or a parameter template to a different existing one across the Parts using it; changing one Part's category (re-mapping or explicitly dropping each parameter); a Part's name, description (including clearing it) and tags; starting a new Part for a Part that has none; adding, editing or removing parameter values; a manufacturer part's MPN and company; and a supplier part's SKU and company.

#### Scenario: Edit a supplier SKU

- **GIVEN** a new supplier part used by a Part shared by two lots
- **WHEN** the operator changes its SKU
- **THEN** the change applies once to the supplier part, and both lots show it.

### Requirement: Unsupported record changes are honest

Retained proposals the executor cannot apply SHALL be shown as “Not supported yet”, together with the nearest supported choice, and SHALL never be silently dropped. These include creating a category, a parameter template or a manufacturer company, changing fields of an existing Part, and supplier prices.

#### Scenario: New category proposed

- **GIVEN** a retained proposal for a new sub-category
- **WHEN** the Part record opens
- **THEN** the category field explains that creating categories is not supported yet, and offers the existing categories, with the agent's reason.

### Requirement: Steering routed to the proposing step

Each record SHALL show which step proposed each field. An “Ask” control SHALL send a message to that step's session. Direct edits SHALL apply immediately, independently of the message.

#### Scenario: Ask about a missing value

- **GIVEN** a required parameter missing on a Part, proposed by Research
- **WHEN** the operator asks Research to find it
- **THEN** the message is queued to Research for that Part, and the parameter shows “Asked Research” until a value or reply arrives.

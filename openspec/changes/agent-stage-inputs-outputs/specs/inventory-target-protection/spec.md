## MODIFIED Requirements

### Requirement: Target semantic read allowlist

The transport SHALL accept only named semantic reads (Part, tagged Part, location, stock, category, parameter template, category parameter, company and Part attachment metadata or file) with a validated positive primary key no larger than the signed 64-bit maximum, and only the `list_locations` and `list_supplier_companies` list reads and the Match search reads in "Match search reads". It MUST NOT accept a raw URL, path or HTTP action.

#### Scenario: Bounded list read

- **GIVEN** a `list_locations` or `list_supplier_companies` read with `limit` 1–100, `offset` at most 10,000 and an optional search of at most 100 characters without control characters
- **WHEN** it is sent
- **THEN** the request uses the fixed path with `ordering=name` and an always-present limit, and a caller timeout may only shorten the five-second deadline.

#### Scenario: Non-semantic or malformed read

- **GIVEN** an unknown operation kind, a zero, negative, non-decimal or out-of-range PK, an over-limit page or an attachment path outside same-origin `/media/attachments/`
- **WHEN** the read is requested
- **THEN** it is refused before any request is sent.

### Requirement: Target effect capability gating

Owned-fake mutation kinds SHALL require the matching capability on the owned profile: location and company creation need `owned-fake-effects/2` or `/3`; Part, parameter, manufacturer, supplier, stock and Part attachment effects accept `owned-fake-effects/1`, `/2` or `/3`; stock attachments need `owned-fake-media/1`; Part image and gaps fill effects need `owned-fake-effects/3`. A missing capability MUST refuse the send before transport.

#### Scenario: Record create under the first effects version

- **GIVEN** an owned loopback profile with `owned-fake-effects/1`
- **WHEN** a location or company create is attempted
- **THEN** it is refused before transport and no request reaches any target.

#### Scenario: Gaps fill without the third effects version

- **GIVEN** an owned loopback profile with `owned-fake-effects/2`
- **WHEN** a gaps fill or Part image effect is attempted
- **THEN** it is refused before transport and no request reaches any target.

## ADDED Requirements

### Requirement: Match search reads

The transport SHALL add bounded Match list reads: `search_parts`, `list_manufacturer_parts`, `list_supplier_parts`, `list_stock`, `list_part_parameters`, `list_part_attachments` and `list_category_parameters`. Each SHALL use a fixed path and ordering, the same limit, offset and search bounds, and only named filters the pinned API offers: search text, MPN, SKU, batch code, `nsn:` stock tag, or a manufacturer, supplier, Part or category PK. Other filters SHALL be refused unsent.

#### Scenario: Stock by Part and batch

- **GIVEN** Match searching a candidate Part's stock for a batch code
- **WHEN** it sends `list_stock` with the Part PK and batch filters and a limit of 20
- **THEN** the request uses the fixed stock path with its fixed ordering, exactly those filters, the limit and offset.

#### Scenario: Missing category parameter

- **GIVEN** a candidate Part whose category maps a key parameter template it has no value row for
- **WHEN** Match runs its sufficiency check
- **THEN** it reads the mappings with `list_category_parameters` by category PK, keeps only mappings of that category or its ancestors, and lists that parameter as missing.

#### Scenario: Category gone

- **GIVEN** a candidate Part whose category can't be read, or was deleted
- **WHEN** Match runs its sufficiency check
- **THEN** the key parameters are reported as unavailable, and no mapping becomes a fill candidate.

#### Scenario: Unnamed filter refused

- **GIVEN** a `list_supplier_parts` read carrying an unnamed `ordering` or a raw query string
- **WHEN** it is requested
- **THEN** it is refused before any request is sent.

### Requirement: Part-scoped reads name their model

`list_part_parameters` and `list_part_attachments` SHALL take a validated Part PK and send their own fixed `model_type` with it as `model_id`.

#### Scenario: Another model with the same id

- **GIVEN** a parameter on Part 12 and another on a different model with id 12
- **WHEN** Match sends `list_part_parameters` for Part 12
- **THEN** the request carries the Part model type and `model_id=12`, and only the Part's parameter is read.

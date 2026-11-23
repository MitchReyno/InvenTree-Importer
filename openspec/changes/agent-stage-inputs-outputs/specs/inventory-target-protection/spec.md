## MODIFIED Requirements

### Requirement: Target semantic read allowlist

The transport SHALL accept only named semantic reads (Part, tagged Part, location, stock, category, parameter template, category parameter, company and Part attachment metadata or file) with a validated positive primary key no larger than the signed 64-bit maximum, and only the `list_locations` and `list_supplier_companies` list reads and the Match search reads in "Match search reads". It MUST NOT accept a raw URL, path or HTTP action.

#### Scenario: Bounded list read

- **GIVEN** a list read with `limit` 1–100, `offset` at most 10,000 and an optional search of at most 100 characters without control characters
- **WHEN** it is sent
- **THEN** the request uses the fixed path with `ordering=name` and an always-present limit, and a caller timeout may only shorten the five-second deadline.

#### Scenario: Non-semantic or malformed read

- **GIVEN** an unknown operation kind, a zero, negative, non-decimal or out-of-range PK, an over-limit page or an attachment path outside same-origin `/media/attachments/`
- **WHEN** the read is requested
- **THEN** it is refused before any request is sent.

## ADDED Requirements

### Requirement: Match search reads

The transport SHALL add bounded list reads for Match's searches and sufficiency check: `search_parts`, `list_manufacturer_parts`, `list_supplier_parts`, `list_stock`, `list_part_parameters` and `list_part_attachments`. Each SHALL use a fixed path, the list bounds above and only named filters: a search text, an exact MPN, manufacturer PK, SKU, supplier PK, Part PK, batch code or barcode. Any other filter SHALL be refused before a request is sent.

#### Scenario: Stock by barcode and batch

- **GIVEN** Match searching for stock with a barcode and a batch code
- **WHEN** it sends `list_stock` with those two filters and a limit of 20
- **THEN** the request uses the fixed stock path with exactly those filters and the limit.

#### Scenario: Unnamed filter refused

- **GIVEN** a `list_supplier_parts` read carrying an unnamed `ordering` or a raw query string
- **WHEN** it is requested
- **THEN** it is refused before any request is sent.

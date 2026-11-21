# digikey-durable-import Specification

## Purpose

A bounded opt-in brings one DigiKey sales order into the durable workflow. It books the purchase order and its line contributions, optionally creates missing supplier models, issues the order and receives it, all with the same plan, journal, ownership and recovery rules as durable stock imports. The legacy DigiKey order commands keep their defaults.

## Requirements

### Requirement: DigiKey durable preparation of one complete order

`import-run prepare-digikey FILE --supplier PK --output PLAN.json` SHALL accept the complete flattened orders array from `orders --order ID --json FILE` only when it holds exactly one sales order. It SHALL require an explicit supplier PK with the supplier role and SHALL NOT fetch vendor data, prompt or write configuration.

#### Scenario: Two orders in the source

- **GIVEN** a source array with two sales orders
- **WHEN** `prepare-digikey` runs
- **THEN** it stops for review before any write and no order is imported

#### Scenario: Receiving without a location

- **GIVEN** receiving is requested and no `--location` is supplied
- **WHEN** preparation runs
- **THEN** it stops for review and no other location is chosen

#### Scenario: Missing product rows

- **GIVEN** `--create-parts` with lines whose SKUs have no supplied product rows
- **WHEN** preparation runs
- **THEN** it stops and asks for the product inputs to be fetched first

#### Scenario: Supplier role missing

- **GIVEN** a `--supplier` PK that is missing or no longer a supplier
- **WHEN** preparation runs
- **THEN** it stops for review before any write

#### Scenario: Booking only

- **GIVEN** `--no-receive`
- **WHEN** preparation runs without `--location`
- **THEN** it plans the order and its contributions only, with no issue or receipt operation

### Requirement: DigiKey durable contribution identity

Each original source line SHALL become its own purchase-order contribution, even when lines share SKU, quantity and price. A line's `reference` SHALL record its correlation but SHALL NOT be treated as a server uniqueness guarantee.

#### Scenario: Repeated SKU

- **GIVEN** two source lines for the same SKU and quantity
- **WHEN** the plan executes
- **THEN** two distinct contributions are created and one receipt covers both

#### Scenario: Uncorrelated existing lines

- **GIVEN** an existing purchase order for the sales order with lines lacking contribution references
- **WHEN** preparation runs
- **THEN** it stops for review instead of guessing which lines are missing

#### Scenario: Reordered source

- **GIVEN** an existing order and a source array whose lines were reordered and have no explicit line IDs
- **WHEN** preparation runs
- **THEN** it stops for review, because identity is the original array digest plus position; lines with explicit IDs survive reordering

### Requirement: DigiKey durable partial and remaining choices

Unmatched lines SHALL stop preparation unless `--partial` freezes that choice in the plan. A partially received existing line SHALL require `--receive-remaining`, which freezes only the observed remainder.

#### Scenario: Partly received line

- **GIVEN** an existing correlated line with part of its quantity already received
- **WHEN** preparation runs without `--receive-remaining`
- **THEN** it stops for review; with the flag, only the observed remaining amount is frozen for receipt

#### Scenario: Over-received line

- **GIVEN** an existing line whose received quantity exceeds the source
- **WHEN** preparation runs
- **THEN** it stops for manual review

### Requirement: DigiKey durable exact amounts

Quantities, prices and received amounts SHALL be captured as exact decimal text, without binary-float conversion or context rounding, within at most 13 integer and 6 fractional digits. Values outside that range, negative or nonfinite SHALL require review rather than rounding.

#### Scenario: Value beyond the supported range

- **GIVEN** a source price with seven fractional digits
- **WHEN** preparation runs, from the CLI or the library
- **THEN** it stops for review before any mutation instead of rounding

#### Scenario: Low caller precision

- **GIVEN** an embedding caller whose decimal context has very low precision
- **WHEN** a receipt payload is computed
- **THEN** the amounts sent are exact

#### Scenario: Zero price and fractional receipt

- **GIVEN** a line with a zero price and a fractional received amount
- **WHEN** the plan executes
- **THEN** both values are sent exactly

#### Scenario: Rounding cache value

- **GIVEN** vendor or cache JSON whose number would change when exported through the legacy numeric interface
- **WHEN** it is decoded
- **THEN** it is rejected rather than silently changed

### Requirement: DigiKey durable historical order date

A supplied order date (order date first, else sales-order date) SHALL be frozen as the purchase order's `creation_date` and SHALL require the target to advertise that field as writable. Without a source date none SHALL be invented, and later date drift SHALL block consumers.

#### Scenario: Date changed after issue

- **GIVEN** an issued order whose server creation date was later changed
- **WHEN** a fresh process attempts the receipt
- **THEN** the receipt is blocked for review

#### Scenario: Invalid or unsupported date

- **GIVEN** an invalid source date, or a target without a writable creation date
- **WHEN** preparation runs
- **THEN** it stops for review, and an older plan that omitted a supplied date is not migrated

### Requirement: DigiKey durable creates and repair

Known purchase-order and contribution PKs SHALL be checkpointed before any dependent request, and an unknown create without a saved PK SHALL stay review-only. A contribution create the server rejected without effect MAY be repaired under its original operation ID.

#### Scenario: Lost contribution create

- **GIVEN** a contribution create that applied but whose response was lost
- **WHEN** repair runs and a line with the matching reference is present
- **THEN** the line is not adopted and the operation stays for review

#### Scenario: Rejected initial line

- **GIVEN** a contribution the server rejected while the order was created
- **WHEN** the operator retries that operation
- **THEN** the missing contribution is created under its original ID and the order is then issued and received

#### Scenario: Cancellation or journal failure first

- **GIVEN** cancellation, or a journal that cannot record intent, before the first DigiKey mutation
- **WHEN** execution starts
- **THEN** no mutation is sent

#### Scenario: Interrupted after checkpoint

- **GIVEN** a process stopped after a contribution PK was checkpointed but before its dependent read
- **WHEN** a fresh process continues
- **THEN** the saved PK is reused and nothing is created again

### Requirement: DigiKey durable consumer preconditions

Before each operation and immediately before each mutation, handlers SHALL recheck the frozen supplier Company identity and role and the approved purchase-order metadata. Order-wide issue, receipt and their reconciliation SHALL require the current contribution set to match the approved set exactly.

#### Scenario: Manual extra line

- **GIVEN** an operator manually added a line to the order after it was booked
- **WHEN** the issue or receipt operation would run
- **THEN** it stops for review and the extra line is left untouched

#### Scenario: Supplier role removed

- **GIVEN** the supplier Company lost its supplier role after preparation
- **WHEN** a shared model create is about to be sent
- **THEN** the create is not dispatched and the dependent work stops

#### Scenario: Substituted line

- **GIVEN** a known contribution whose Part, price or currency was changed on the server
- **WHEN** issue or receipt would run
- **THEN** it stops for review and no manual row is deleted or rewritten

### Requirement: DigiKey durable issue and receipt

Issue and receipt SHALL be separate operations, with receipt sending one request for all approved line amounts and recording each line's effect. An accepted or unknown issue or receipt SHALL never be sent again, and changed state SHALL require review rather than a new calculation.

#### Scenario: Lost issue and receipt in a fresh process

- **GIVEN** issue and receipt requests that applied but whose responses were lost
- **WHEN** a fresh process repairs them
- **THEN** the observed status and exact totals settle both intents without another request, and the unknown attempts stay in history

#### Scenario: Manual receipt before dispatch

- **GIVEN** a manual receipt that changes a line's total after the receipt amounts were selected
- **WHEN** the final dispatch check runs
- **THEN** no receive request is sent and the operation needs review instead of computing a new remainder

#### Scenario: Partially applied receipt

- **GIVEN** a receipt whose observed totals show only some lines received
- **WHEN** repair runs
- **THEN** the operation stays for review and no remaining lines are received

#### Scenario: Status gates

- **GIVEN** orders in pending (10), open (20), completed (30) and cancelled, held or reset states
- **WHEN** issue or receipt would be sent
- **THEN** issue is sent only from 10, receipt only from 20, stable full totals settle on 20 or 30 without a request, and other states need review

#### Scenario: Final dispatch check

- **GIVEN** a receipt whose amounts were selected
- **WHEN** it is about to be sent
- **THEN** received totals, status and location are rechecked with the Company, order and contribution set, and the check is journaled before the request intent

#### Scenario: Accepted receipt with conflicting read-back

- **GIVEN** a receipt the server accepted whose read-back disagrees
- **WHEN** the result is recorded
- **THEN** it is a valid needs-review result that keeps the confirmed effects, and fresh-process repair does not repeat it

### Requirement: DigiKey durable ownership namespace

The import identity SHALL be the supplier PK plus the original sales order ID, shared with the supported legacy order writers. An unresolved durable claim SHALL block a legacy write of the same order while other orders proceed.

#### Scenario: Legacy writer after an unknown durable effect

- **GIVEN** a durable run for a sales order with an unknown effect
- **WHEN** the legacy order import writes that order
- **THEN** it is refused, while another order imports normally

#### Scenario: Legacy batch claims

- **GIVEN** a legacy import of several orders
- **WHEN** it starts writing
- **THEN** all their claims are acquired under one process writer before any effect

### Requirement: DigiKey durable line controls

Contribution creation SHALL require target OPTIONS to advertise writable `merge_items`, `auto_pricing` and a long enough `reference`, frozen in the preview with both controls `false`. Execution SHALL recheck support before the POST and validate source quantity, price and currency before dependent work.

#### Scenario: Capability missing

- **GIVEN** a target whose OPTIONS do not advertise a writable `merge_items`
- **WHEN** a contribution would be created
- **THEN** creation is blocked before the POST

#### Scenario: Price override

- **GIVEN** a contribution whose server price differs from the frozen source price
- **WHEN** receipt would follow
- **THEN** the dependent receipt is blocked

#### Scenario: Older plan

- **GIVEN** a stored DigiKey plan without frozen line controls
- **WHEN** a pending contribution would be created
- **THEN** it is not created, while inspection and repair of known outputs still work

### Requirement: DigiKey durable model-only scope

With approval, the DigiKey opt-in SHALL create only Part, manufacturer, supplier-part and parameter models plus purchase-order, issue and receipt work, using the shared matching and raw-create policies. It SHALL plan no stock, barcode, image, datasheet or archive operations and SHALL run serially.

#### Scenario: Create missing supplier models

- **GIVEN** a prepared order with `--create-parts` and fetched product rows for unknown SKUs
- **WHEN** the plan executes
- **THEN** the Parts and supplier parts are created, and no stock or barcode operation appears in the plan

#### Scenario: Guarded sends

- **GIVEN** a DigiKey execution through the pinned SDK
- **WHEN** issue and receipt are sent
- **THEN** every actual send has one guarded pre-send intent

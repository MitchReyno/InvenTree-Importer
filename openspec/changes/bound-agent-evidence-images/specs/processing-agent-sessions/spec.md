# Capability delta

## ADDED Requirements

### Requirement: Bounded agent evidence images

Every image fetch_evidence returns to an agent SHALL be cut from the version's decoded page preview, be at most 2,576 px on its long edge and at most 1.25 MiB encoded. The result SHALL state the delivered width, height and scale relative to the page preview, and the per-run image budget SHALL count the delivered bytes.

#### Scenario: Large original in a lot session

- **GIVEN** a lot session whose manifest delivers a 6144 × 8160 photo
- **WHEN** the agent fetches that evidence without a page or region
- **THEN** it receives a 1940 × 2576 image with its width, height and scale stated. The result's source reference names the original version and its SHA-256, and a proposal citing that reference is accepted.

#### Scenario: Large region of a page

- **GIVEN** an Examine session and a page preview of 6144 × 8160
- **WHEN** the agent requests a region 5000 px wide and 6000 px tall in page-preview pixels
- **THEN** it receives that region scaled to fit within 2,576 px, with the scale stated, and the cited source is the version, not the crop.

#### Scenario: Small region or small page

- **GIVEN** a region, or a lot session's page, no larger than 2,576 px on either side
- **WHEN** the agent fetches it
- **THEN** it receives it at its own size, never enlarged, with scale 1, and a later region request still uses page-preview pixels.

#### Scenario: Examine overview

- **GIVEN** an Examine session and a page of any size
- **WHEN** the agent fetches it without a region
- **THEN** it receives an overview at most 768 px on its long edge, lossless where it fits the size cap, with its scale stated.

#### Scenario: Requested page has no preview

- **GIVEN** a version the session may fetch, whose requested page has no decoded preview
- **WHEN** the agent fetches it
- **THEN** the result refuses with `validation_failed`, grants no delivery authority, and sends no original bytes. Encrypted and undecoded versions never reach a session: a lot manifest refuses them as `media_not_ready` and Examine leaves them out.

#### Scenario: Too large at any quality, or removed meanwhile

- **GIVEN** a cut that exceeds 1.25 MiB even at the lowest JPEG quality, or evidence the operator removes while its preview is read
- **WHEN** the agent fetches it
- **THEN** the result carries metadata only, or refuses with `media_evidence_removed`; no image is sent, the budget is not charged, and no delivery authority is granted.

## MODIFIED Requirements

### Requirement: Categorized failures with diagnostic disclosure

Processing and session history SHALL display a failure category, actionable summary and accessible Show details button. Details SHALL retain safe technical context across reloads, obey session read scope and exclude sensitive data before persistence. Legacy or unknown failures SHALL identify unavailable information without inventing a cause or retry guarantee. When a provider ends a turn with a structured error, the details SHALL include the provider's error kind from a fixed list, its result type and HTTP status when it gives them, and never the provider's message text.

#### Scenario: Operator inspects a failed session

- **GIVEN** a failed provider turn
- **WHEN** the operator opens its Processing view or session-history entry and activates Show details
- **THEN** a readable diagnostic panel opens with category, stage, stable error code, timestamp, session/attempt and correlation IDs, bounded safe causes, provider/model/version when known, and recovery guidance; closing it preserves the current selection and drafts, and disclosure never starts a retry.

#### Scenario: Provider reports why a turn failed

- **GIVEN** a Claude turn whose assistant message carries the error kind `invalid_request` and whose result type is `error_during_execution`, or a Codex turn that fails with `contextWindowExceeded` or with `httpConnectionFailed` and HTTP status 503
- **WHEN** the failure is retained and its details are opened
- **THEN** the panel shows `agent_turn_failed` with the provider error kind, and the result type or HTTP status where given. No provider message text is stored or shown.

#### Scenario: Unrecognized provider error kind

- **GIVEN** a provider error kind or result type outside the fixed list, or one longer than the stored limit
- **WHEN** the failure is retained
- **THEN** the provider error kind is recorded as `unknown` and the unrecognized value is not stored.

#### Scenario: Legacy and unknown failures

- **GIVEN** an older failed session with no retained diagnostics, or an unclassified failure
- **WHEN** its details are opened
- **THEN** the UI shows unavailable legacy details or an Unknown category with the available correlation context, without claiming the failure is retryable.

#### Scenario: Sensitive or cross-session diagnostics

- **GIVEN** an exception containing a secret or a details request outside the caller's scope
- **WHEN** diagnostics are retained or read
- **THEN** credentials, capabilities, connection strings, private paths, raw prompts and evidence payloads are excluded before persistence; debug text and stacks are sanitized and bounded, raw exceptions are never exposed, and unauthorized reads reveal no diagnostic record.

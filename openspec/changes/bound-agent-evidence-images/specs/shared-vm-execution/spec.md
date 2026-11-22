# Capability delta

## ADDED Requirements

### Requirement: Guest-staged evidence matches the delivered image

The guest SHALL stage the image a fetch_evidence delivery carries, and record that image's own SHA-256, size and dimensions with it. A staged image whose bytes don't match the delivery's stated digest SHALL be refused before the provider sees it. The cited source reference SHALL remain the original version. A reply from an older host, without a delivered digest, SHALL still be staged under the earlier rule.

#### Scenario: Script crops a bounded delivery

- **GIVEN** a VM session that fetched a 6144 × 8160 photo, delivered at 1940 × 2576
- **WHEN** a guest script reads the staged local file
- **THEN** the file is the 1940 × 2576 image, its recorded digest matches its bytes, and the scale needed to map back to page-preview pixels is in the result.

#### Scenario: Tampered delivery

- **GIVEN** a delivery whose image bytes don't match its stated delivered digest
- **WHEN** the guest stages it
- **THEN** staging fails with `invalid_evidence_file` and the provider receives no image.

### Requirement: Guest-reported provider error

A guest turn that ends with a provider error SHALL send the provider's error kind, result type and HTTP status with its failure outcome, using the same fixed list as the session failure. The host SHALL accept only listed values. A turn settled from the guest journal after a lost connection SHALL settle with its outcome alone.

#### Scenario: Failed provider turn in the guest

- **GIVEN** a VM turn whose Claude result fails with the error kind `invalid_request`
- **WHEN** the guest sends its failure outcome
- **THEN** the host retains `agent_turn_failed` with that provider error kind.

#### Scenario: Unlisted value from the guest

- **GIVEN** a guest frame whose provider error kind is not on the fixed list
- **WHEN** the host settles the turn
- **THEN** the failure is retained with the provider error kind `unknown`.

#### Scenario: Settled from the journal

- **GIVEN** a turn whose connection was lost and whose outcome is read back from the guest journal
- **WHEN** the host settles it
- **THEN** it settles with the journaled outcome and no provider error, as before.

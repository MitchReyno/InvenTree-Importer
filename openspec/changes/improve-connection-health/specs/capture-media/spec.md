# Capture media delta

## ADDED Requirements

### Requirement: Bounded parallel processing of retained photos

Qualified hosts SHALL support two simultaneous independent photo decodes under one shared capacity limit. One-slot operation SHALL remain supported. Ordered uploads and revision checks, durable claim identity, per-job isolation, original evidence, and all-or-nothing publication SHALL be preserved. Saturation SHALL leave excess work eligible without allocating an additional decoder or failing a valid photo.

#### Scenario: Several photos in one batch

- **GIVEN** two available slots and three separately retained photos
- **WHEN** workers process that batch
- **THEN** two decodes can overlap, the third waits for capacity, and each result is published once against its own version even when the second finishes first.

#### Scenario: Competition and interruption

- **GIVEN** simultaneous decode, figure and backfill demand
- **WHEN** slots fill or a worker stops after claiming a command
- **THEN** aggregate use stays bounded, waiting work survives, an ambiguous claim retains its existing interruption policy, and unrelated work can finish without partial publication.

#### Scenario: Qualification under interactive load

- **GIVEN** matched runs with one and two slots on the same host using the design's mixed workload
- **WHEN** selecting the host default
- **THEN** two slots are enabled only if batch completion improves by at least 20%, interactive read p95 regresses by at most 10%, liveness p95 stays below one second, and all integrity and aggregate resource checks pass.

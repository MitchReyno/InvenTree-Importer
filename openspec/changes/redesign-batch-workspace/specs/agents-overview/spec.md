# Capability delta

## Purpose

An app-level Agents page shows every agent session across batches. The operator sees capacity, what is waiting for them and what each agent is doing, without opening each batch.

## ADDED Requirements

### Requirement: Agents page

The Agents page SHALL list every agent session in authorised scope, grouped by batch. Each session SHALL show its step, subject, latest status line, state (running, waiting for you, queued, finished, interrupted) and when that state started. A summary SHALL show slots in use against the limit, the model in use, and how many sessions are waiting for the operator. Filters SHALL include running, waiting for you, queued and finished today. Each batch group SHALL link to that batch's Processing.

#### Scenario: Waiting sessions do not count as running

- **GIVEN** three running sessions and two waiting for answers, with a limit of three
- **WHEN** the page opens
- **THEN** it shows 3 of 3 slots in use and 2 waiting for you, and the waiting sessions are labelled as holding no slot.

#### Scenario: No session support yet

- **GIVEN** a profile without native sessions
- **WHEN** the page opens
- **THEN** it says agent sessions are not available for this setup and links to Agent settings, without showing an empty list as “nothing running”.

## ADDED Requirements

### Requirement: Media decodes wait for a busy decoder

A decode that finds the decoder busy with other work for its whole bounded wait SHALL NOT end `interrupted`, since nothing ran. Its command SHALL be deferred durably and taken again by a later worker run, and its version SHALL read `queued` until a decode runs. A decode that ran, or whose decoder failed otherwise, SHALL end as before. Waiting SHALL NOT take a second database connection per worker.

#### Scenario: Decoder busy throughout

- **GIVEN** an uploaded photo whose media worker finds the decoder busy with another worker's decode for its whole wait
- **WHEN** the worker stops waiting
- **THEN** the photo reads `queued`, not `interrupted`, and the next worker run decodes it to `ready`.

#### Scenario: A real failure after a busy reply

- **GIVEN** a decode whose decoder was busy at first and then failed without a result
- **WHEN** the worker records it
- **THEN** the version reads `interrupted`, as before, and is not taken again.

#### Scenario: One worker takes a deferred decode

- **GIVEN** a deferred decode and two media workers looking for work at once
- **WHEN** both claim
- **THEN** only one of them takes the deferred decode.

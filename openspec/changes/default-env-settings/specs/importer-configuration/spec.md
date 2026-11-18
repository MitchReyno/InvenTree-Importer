# Capability delta

## Purpose

The importer (`invimport`) finds the InvenTree server and credentials it works against, and its DigiKey locale, with sensible defaults, so a developer with the local development InvenTree needs no server settings and every importer path agrees on the server in use.

## ADDED Requirements

### Requirement: The local development InvenTree is the default server

When none of `INVENTREE_URL`, `INVENTREE_TOKEN`, `INVENTREE_USER` and `INVENTREE_PASSWORD` has a non-empty value in the environment or the env file (an empty value counts as unset), the importer SHALL use the local development InvenTree at `http://127.0.0.1:4320` with the writer token kept by `pnpm inventree:dev`, when that state exists and is valid.

#### Scenario: Local InvenTree only

- **GIVEN** no InvenTree settings and a ready local development InvenTree
- **WHEN** an importer command that connects runs
- **THEN** it connects to `http://127.0.0.1:4320` with the writer token and says it is using the local development InvenTree

#### Scenario: Explicit settings win

- **GIVEN** `INVENTREE_URL` and `INVENTREE_TOKEN` are set
- **WHEN** an importer command runs
- **THEN** it uses them and does not read the local development state

#### Scenario: Untouched template

- **GIVEN** a `.env` copied from `.env.example`, whose InvenTree settings are present but empty, and a ready local development InvenTree
- **WHEN** an importer command that connects runs
- **THEN** it uses the local development InvenTree

#### Scenario: Empty shell override

- **GIVEN** `INVENTREE_URL=` exported empty in the shell and a ready local development InvenTree
- **WHEN** an importer command that connects runs
- **THEN** it treats the setting as unset and uses the local development InvenTree

#### Scenario: Partly configured

- **GIVEN** a non-empty `INVENTREE_URL` without a token, or a non-empty token or user without a URL
- **WHEN** an importer command that connects runs
- **THEN** it refuses as it does today, without filling in the missing part from the local instance

#### Scenario: No local instance

- **GIVEN** no InvenTree settings and no valid local development state
- **WHEN** an importer command that connects runs
- **THEN** it refuses, naming `INVENTREE_URL` and `pnpm inventree:dev up` as the two ways to configure a server

#### Scenario: Plan bound to another server

- **GIVEN** an approved plan for an external endpoint, and no InvenTree settings, so the local instance is used
- **WHEN** execute, resume or retry runs
- **THEN** it stops before connecting and reports the endpoint mismatch

#### Scenario: Unsafe state file

- **GIVEN** the local state file is a symbolic link, not owned by the user, readable by others, or not valid
- **WHEN** the importer looks for the local instance
- **THEN** it does not use it and refuses as in "No local instance"

### Requirement: The default server is applied once and announced

The importer SHALL fill in the local server before any command reads the InvenTree settings, so the connection and the approved-plan endpoint check see the same server. It SHALL print the server it uses and that it is the local development InvenTree, and SHALL never print the token.

#### Scenario: Announced without the token

- **GIVEN** the local development InvenTree is used by default
- **WHEN** an importer command starts
- **THEN** its output names `http://127.0.0.1:4320` as the local development InvenTree and contains no token

#### Scenario: Plan check sees the default

- **GIVEN** the local development InvenTree is used by default
- **WHEN** the approved-plan endpoint check runs
- **THEN** it compares the plan with `http://127.0.0.1:4320`

### Requirement: DigiKey locale defaults

The importer SHALL default `DIGIKEY_LOCALE_SITE` to `US`, `DIGIKEY_LOCALE_CURRENCY` to `USD` and `DIGIKEY_LOCALE_LANGUAGE` to `en`. Explicit values SHALL win.

#### Scenario: Unset locale

- **GIVEN** no DigiKey locale settings
- **WHEN** a DigiKey request is built
- **THEN** it uses the US site, USD and English

#### Scenario: Explicit locale

- **GIVEN** `DIGIKEY_LOCALE_SITE=AU` and `DIGIKEY_LOCALE_CURRENCY=AUD`
- **WHEN** a DigiKey request is built
- **THEN** it uses the Australian site and AUD

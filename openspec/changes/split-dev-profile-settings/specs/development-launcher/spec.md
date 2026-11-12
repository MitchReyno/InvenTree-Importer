# Capability delta

## Purpose

`pnpm dev` turns a small set of independently named switches into the processing profile, inventory target and optional services of the local app, so a developer can tell from the setting names alone what the app will run, and retired profile names fail with a pointer to their replacements.

## ADDED Requirements

### Requirement: Processing switches select the profile

The development launcher SHALL select the processing profile from `INTAKE_USE_MOCK_AI_AGENTS` (default true), `INTAKE_USE_AGENT_SESSIONS` (default true), `INTAKE_RUN_AGENTS_IN_VM` (default false) and `INTAKE_VM_AGENT_TOOLS` (default true), and SHALL pass only the resulting existing profile ID to its child processes.

#### Scenario: Profile table

- **GIVEN** each combination below, with other switches at their defaults
- **WHEN** the launcher resolves the profile
- **THEN** it selects:

| Mock agents | Sessions | VM | Other | Profile |
|---|---|---|---|---|
| true | false | false | | `synthetic-research/2` |
| true | true | false | | `synthetic-session/1` on the host |
| true | true | true | | `synthetic-session/1` through the VM bridge |
| false | false | false | | `native-agent/1` |
| false | true | false | | `native-agent/2` |
| false | true | true | tools false | `shared-vm-agent/1` |
| false | true | true | tools true | `shared-vm-agent/2` |

#### Scenario: Defaults

- **GIVEN** no processing switches
- **WHEN** `pnpm dev` starts
- **THEN** the profile is `synthetic-session/1` on the host, and the startup output names it.

#### Scenario: Unsupported combination

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` with `INTAKE_USE_AGENT_SESSIONS=false`
- **WHEN** the launcher resolves the profile
- **THEN** it refuses with `unsupported_agent_settings` before any setup.

#### Scenario: VM pairing required

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` without `INTAKE_VM_PAIR` and `INTAKE_VM_PORT`
- **WHEN** the launcher resolves the profile
- **THEN** it refuses with `vm_pairing_required` before any setup.

#### Scenario: VM credential management

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true`
- **WHEN** the UI process starts
- **THEN** it serves the personal credential management proxy; with the VM switch off it does not.

### Requirement: Switch values and retired names

Each switch SHALL accept `true`, `false`, `1` or `0` in any letter case, and treat an empty value as unset. The launcher and `pnpm codex:login` SHALL refuse the retired names `INTAKE_TARGET_PROFILE`, `INTAKE_PROCESSING_PROFILE`, `INTAKE_READ_ORIGIN`, `INTAKE_DEV_API_KEY` and `INTAKE_PERSONAL_MANAGEMENT` in their settings.

#### Scenario: Invalid switch value

- **GIVEN** a switch set to a value such as `yes`
- **WHEN** the launcher reads its settings
- **THEN** it refuses with `invalid_development_setting` and names the variable without echoing its value.

#### Scenario: Retired name

- **GIVEN** an env file or shell setting containing `INTAKE_PROCESSING_PROFILE` or another retired name
- **WHEN** `pnpm dev` or `pnpm codex:login` starts
- **THEN** it refuses with `retired_development_setting` and names each retired variable with its replacement, without echoing values.

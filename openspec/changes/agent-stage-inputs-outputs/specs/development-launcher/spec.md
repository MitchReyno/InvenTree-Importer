## MODIFIED Requirements

### Requirement: Processing switches select the profile

The development launcher SHALL select the processing profile from `INTAKE_USE_MOCK_AI_AGENTS` (default true), `INTAKE_USE_AGENT_SESSIONS` (default true), `INTAKE_RUN_AGENTS_IN_VM` (default false), `INTAKE_VM_AGENT_TOOLS` (default true) and `INTAKE_VM_AGENT_DRAIN` (default false), and SHALL pass to the API and worker children only the resulting existing profile ID, the synthetic route (`local` or `bridge`) and the drain setting.

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
| false | true | true | tools true | `shared-vm-agent/4` |
| false | true | true | tools true, drain true | `shared-vm-agent/3`, with the cutover drain fence set |

#### Scenario: Defaults

- **GIVEN** no processing switches
- **WHEN** `pnpm dev` starts
- **THEN** the profile is `synthetic-session/1` on the host, and the startup output names it.

#### Scenario: Unsupported combination

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` with `INTAKE_USE_AGENT_SESSIONS=false`
- **WHEN** the launcher resolves the profile
- **THEN** it refuses with `unsupported_agent_settings` before any setup.

#### Scenario: VM pairing required

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` with an explicit `INTAKE_VM_PORT` that is not a port from 1 to 65535
- **WHEN** the launcher resolves the profile
- **THEN** it refuses with `invalid_vm_launch_setting` before any setup, naming `INTAKE_VM_PORT`.

#### Scenario: VM pairing defaults

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true` without `INTAKE_VM_PAIR` and `INTAKE_VM_PORT`
- **WHEN** the launcher resolves the profile
- **THEN** it uses the default pairing directory and port 14313 instead of refusing.

#### Scenario: VM credential management

- **GIVEN** `INTAKE_RUN_AGENTS_IN_VM=true`
- **WHEN** the UI process starts
- **THEN** it serves the personal credential management proxy; with the VM switch off it does not.

#### Scenario: Children share the route

- **GIVEN** the default switches
- **WHEN** `pnpm dev` starts
- **THEN** the API and session worker children both receive `synthetic-session/1`, the `local` route and drain off through their environment allowlists.

#### Scenario: Drain then switch

- **GIVEN** a VM actor with retained `shared-vm-agent/3` work
- **WHEN** the developer runs `pnpm dev` with `INTAKE_VM_AGENT_DRAIN=true` until the drain completes, then without it
- **THEN** the first run serves `/3` with the fence set and the second serves `/4`, each through the session worker.

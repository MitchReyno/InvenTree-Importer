# Change proposal

## Problem and intended outcome

Describe the concrete problem, who experiences it and the observable improvement sought. Reuse established answers and distinguish requested behavior from assumptions.

## Change identity and linked items

Use the canonical short descriptive kebab-case change name returned by the CLI. That exact name belongs in the change directory, all delivering branches and every commit/PR subject (`type(change-name): description`). Keep it stable and use meaningful branch suffixes for separate PR bundles.

Link applicable BI entries in `docs/PLANNED_FUNCTIONALITY.md`, or state None with a reason. The repository index owns current item priority, size, prerequisites and status; detailed planning lives in this OpenSpec change.

## Current behavior and evidence

Describe relevant observed behavior with source, test or document references. Identify unverified assumptions and boundary limitations. Include a concise before/after description when useful.

## Scope and non-goals

State the cohesive outcome, changes included and deliberate exclusions. Record compatibility constraints and existing authorization boundaries.

## Reuse and dependency assessment

Identify existing implementations and installed dependencies from relevant source, manifests and lockfiles. Investigate external packages, dependencies or frameworks that could achieve the goals before recommending substantial custom implementation. Scale the investigation to the change; explain when no relevant external alternative exists or no runtime/dependency decision is involved.

Compare meaningful options, including reuse/extension of the existing stack and custom implementation where viable. For each option record requirement fit, pros, cons, compatibility, maintenance, licensing/security constraints, integration effort and ongoing operational/dependency cost. Include migration or lock-in concerns where relevant; do not manufacture a fixed number of candidates.

| Option and relevant version                                                                         | Goal fit and strengths       | Limitations, risks and total adoption cost | Primary evidence and date checked                                                 | Unknowns / proof of fit                                              |
| --------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Replace with a real viable option, or give a justified not-applicable assessment instead of a table | Explain which goals it meets | Weigh the concrete downsides               | Link official documentation, release/source evidence and current repository facts | Distinguish investigated facts from untested integration assumptions |

State the recommended direction, why it wins for this project, and why meaningful alternatives were rejected. Explain any custom implementation retained and what a dependency cannot safely or economically own. Keep implementation architecture in the design assessment.

## Capabilities

### New capabilities

List durable capability paths and the behavior each will own, or None.

### Modified capabilities

List exact existing capability paths whose requirements change, or None. For no behavioral delta, explain the change's `skip_specs: true` declaration instead of inventing requirements.

## Impact and dependencies

Identify affected applications, interfaces, state, evidence and external prerequisites. Link relevant existing decisions and prerequisite tickets. Record implementation dependencies here without duplicating mutable backlog metadata.

## Open decisions and assumptions

Record unresolved material choices, recommendations and reasonable minor assumptions. Remove resolved questions or record their decision where it belongs. State None when resolved.

# Design assessment

## Context and grounding

Summarize affected boundaries, existing patterns and evidence from source/tests. State the complexity assessment. For simple changes, explain why existing architecture suffices and keep the remaining assessment concise.

## Goals and constraints

Link the proposal and relevant requirements. Identify the design outcomes and constraints without restating the full proposal or adding scope.

## Decisions and alternatives

For each material decision, use a titled subsection and record the choice, rationale, meaningful alternatives rejected and reasons, and accepted trade-offs. Carry forward the proposal's reuse assessment and source links; confirm the chosen dependency/version fit, document remaining integration checks, and refresh the comparison if material assumptions change. Explain any retained custom implementation. If no new architectural decision is needed, state that with evidence. Do not manufacture alternatives.

## State, authority and failure behavior

Explain applicable data flow, state ownership, revisions/identity, authorization, effects, uncertainty, recovery and compatibility. Use diagrams or tables where they make a real contract clearer. State why a concern does not apply when relevant.

## Verification strategy

Map the change's outcomes and material risks to appropriate unit, contract, integration, process, UI or manual checks. Identify the actual boundary each check establishes, required tooling and unavailable or synthetic limits. Do not prescribe one test per scenario.

## Migration, rollout and recovery

Describe applicable migration, deployment, observability, rollback and retained-effect handling. For changes without these concerns, state why they do not apply. A plan does not authorize live operations.

## Risks and open decisions

Record remaining risks, mitigations and material decisions requiring the user. State None when resolved. Keep resolved choices in Decisions rather than retaining a progress log.

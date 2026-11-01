# Intake integration spikes

These are provisional investigation inputs and contracts, not a deployed intake backend or a second importer. Read the [shared fixture and message contract](shared/README.md) before implementing the subscription-runner, durable-coordinator or importer-adapter spikes. Each spike can branch from `interactive-app` and use these same assets in its own worktree and isolated fake state.

The common contract does not select a provider, workflow runtime, transport or database. Findings can change it through an explicit versioned update with changed examples and conformance checks. Do not start a model session or write inventory just by running its tests.

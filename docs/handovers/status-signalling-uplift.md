# Status signalling uplift backlog capture

Scope: register BI-002 and the separate `status-signalling-uplift` OpenSpec brief. This is backlog capture only; no header, transport, agent, dependency or inventory implementation is included. Mutable metadata belongs to the repository index.

Plan before edits: check the merged index/history and existing changes for collisions, inspect the current masthead and original prototype header/activity control, scaffold the brief using the native CLI, link it from the index, then check Markdown, identity and local references before independent exact-head review and selected CI. Publish on `docs/status-signalling-uplift` against `interactive-app` and merge under standing authorization only when those gates pass.

BI-001 is the separately merged Capture uplift; the next unused allocation is BI-002. The current masthead has a Manual workflow label. Existing LiveUpdates and AgentSessions components provide investigation entry points, not proof that all target-health/workflow data required for the new header is available. The original prototype's Processing in progress state and `activityHTML()` supply the composition reference; the requested connection-details popover and active agents extend it. Prototype operations are simulated, and its fictional InvenTree URL must not become a production target.

No new runtime dependency is required to capture this Markdown item. Detailed proposal research should assess existing components, maintained popover frameworks and authoritative health/progress/session projections, including missing data contracts, before implementation. The two requested changes have no known ordering dependency; actual implementation prerequisites remain unassessed.

- [x] Record connection status/details, adjacent InvenTree access and the separate expandable workflow/steps/agents indicator with original mockup links.
- [x] Validate native scaffold, metadata/ID uniqueness, local links, Markdown and whitespace before committing completed capture work.

Independent review, publication, CI and merge remain separate evidence gates. The feature remains Proposed after the documentation merges.

Validation passed: native CLI resolves `bench-intake` and correctly reports the scaffold planning-incomplete; Markdown, local links, unique BI-001/BI-002 identities and whitespace checks pass. No skill or application files changed, so workflow-sync and runtime suites were not rerun.

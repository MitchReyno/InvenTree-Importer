# Interactive app planning schema

## Plan recorded before implementation

The user requested a custom OpenSpec schema based primarily on the useful OpenSpec Plus practices, with the agreed adaptations for reduced approval overhead, source-grounded planning, repeated independent review, proportionate testing and the existing publication workflow. An external schema example supplies folder-structure inspiration only; no company schema content, tools or policies are imported.

Scope: add `openspec/schemas/bench-intake/schema.yaml`, a schema README and four artifact templates; select it in `openspec/config.yaml`; update OpenSpec usage documentation and the mirrored planned-functionality skill to explain the boundary between capture and detailed planning. Keep the existing standard OpenSpec lifecycle skills, native commands, project instructions and register ownership. Update existing unmerged PR #66 rather than create a competing setup. The user's merge hold remains in force.

No product features, real inventory calls, provider calls or application runtime changes are authorized here. Do not install OpenSpec Plus or add another orchestration layer. No new package is needed: the installed OpenSpec 1.16.0 CLI supports project-local schemas, artifact instructions/templates, dependency graphs, tracked checkboxes and `skip_specs: true` for changes without behavioral deltas. Upstream Plus 1.6.1 at `311dd818f2de99d38c1f0a144fc4946895d6aed4` informs the planning practices; the schema is authored for this project.

## Decisions and alternatives

- Use one schema with standard `proposal`, `specs`, `design` and `tasks` artifact IDs so native status, apply, sync and archive retain their conventions. The register owns priority, relative size, prerequisites and current product status; artifacts link BI IDs instead of becoming another backlog.
- Require a design assessment file for every schema-driven change. Simple work can use a concise assessment with no new architectural decisions; substantial work covers alternatives, risks and verification. This avoids calling an artifact optional while downstream dependencies require it. Backlog capture alone does not enter this workflow.
- Keep native spec opt-out for genuine nonbehavioral changes, with no invented requirements. Verify skipped-spec state and rejection of contradictory deltas using the installed CLI in isolated fixtures.
- Put shared working practices in the schema README referenced by each artifact instruction; keep artifact-specific guidance in YAML and document shape in templates. Keep approval and authority policy consistent with the existing lifecycle adaptations.
- Use observable slices with real dependencies, allowing maintenance, investigation, migration, configuration and documentation tasks when justified. Keep TDD useful for changed behavior without a rigid per-test ceremony or deleting existing work. Keep review-and-fix rounds and exact-head publication checks.
- Considered installing all Plus skills, custom orchestration, or several schema variants. These duplicate lifecycle ownership and add unnecessary maintenance before concrete use cases justify them.

## Implementation and validation plan

1. Write the schema, shared practices and templates; select the schema and update active docs/skill routing.
2. Run schema validation and inspect actual `instructions` JSON for all artifacts and apply. In temporary projects, exercise fresh state, prerequisite unlocking, behavioral deltas, skipped specs, task progress and strict change validation. Keep fixtures out of the real register and change tree.
3. Check Markdown, portable references, identical skill copies and workflow-sync. Run the repository normal suite; record unavailable checks and failures honestly.
4. Commit, obtain independent exact-head review with realistic behavior/maintenance/capture scenarios, fix findings and repeat until clear. Push and update PR #66, verify selected CI, and leave it unmerged for the user.

Schema validation proves format, template resolution and graph behavior only. Agent adherence, quality of generated plans and application execution guarantees require separate evidence. No live feature plan is created as a side effect of qualification.

## Current result

The schema, four templates and shared practices are implemented under `openspec/schemas/bench-intake/`; the project default selects `bench-intake`. Active register conventions, detail templates and mirrored maintenance skill now use BI identifiers. The user selected Bench Intake as the prefix basis and accepted BI; no real items were allocated or migrated. Standard OpenSpec lifecycle skills remain in place, and no Plus skills are installed.

OpenSpec 1.16.0 reports the schema valid with no issues and resolves it from the project. Actual instruction JSON includes the custom templates/instructions for all four artifacts, resolved output paths inside the isolated project, and the custom apply instruction plus separate operation guidance. The initial instruction query without a change correctly reported no real changes; all further qualification uses disposable projects.

An isolated synthetic behavioral change and a nonbehavioral documentation change exercise these CLI outcomes:

| Check                                     | Observed result                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Fresh state                               | Only proposal ready; specs, design and tasks blocked                                                       |
| Proposal present                          | Specs ready; design and tasks still blocked                                                                |
| Behavioral delta present                  | Design ready; tasks blocked until design assessment exists                                                 |
| Required design present                   | Tasks ready                                                                                                |
| Strict behavioral validation              | Passes with native headings, Purpose and complete scenarios                                                |
| Native checkbox progress                  | Two completed tasks and one held merge remain 2/3, apply still ready                                       |
| `skip_specs: true`                        | Specs reported skipped; design/task dependencies satisfied without a delta                                 |
| Strict nonbehavioral validation           | Passes without invented behavioral requirements                                                            |
| Contradictory delta under spec opt-out    | Rejected                                                                                                   |
| Malformed scenario headings               | Rejected by strict validation                                                                              |
| Required design removed after tasks exist | Status still reports existing tasks done; explicit apply prerequisite checks are therefore required        |
| Native archive in synthetic fixture       | Creates a valid main spec preserving Purpose and complete requirements; strict main-spec validation passes |

Commands exercised: `openspec schema validate bench-intake --json`, `openspec schema which bench-intake --json`, `openspec new change`, `openspec status --change ... --json`, `openspec instructions <artifact-or-apply> --change ... --json`, `openspec validate <change> --strict --no-interactive`, and synthetic-only `openspec archive <change> --yes` followed by strict main-spec validation. Fixtures are kept outside the real register and change tree; no real archive or product operation occurred.

Markdown checks and active documentation/schema file-link checks pass. Both maintenance-skill copies pass the skill validator; workflow synchronization passes 8 tests and confirms identical authored copies. The normal repository suite is running; independent exact-head review and hosted CI are pending. The merge hold remains in force.

## Identifier refinement

During preparation the user requested a project-name prefix, then selected Bench Intake as the naming basis and accepted `BI-001`, `BI-002`, and so on. No real PF or INV items were allocated. Update active conventions and templates to BI; preserve historical handovers as records of the earlier setup.

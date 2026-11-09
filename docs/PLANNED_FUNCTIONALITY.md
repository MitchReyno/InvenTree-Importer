# Planned Bench Intake functionality

This repository index tracks requested future features, fixes, improvements and maintenance for the interactive app on `interactive-app`. Each item links directly to its OpenSpec change for details. Plans are not implementation or release commitments.

Maintain the index with the project-level `planned-functionality` skill. Use the [Bench Intake OpenSpec workflow](openspec.md) for detailed planning. Capturing an item can create a change scaffold with its brief description; it does not require completing all proposal/design/tasks artifacts or authorize implementation.

## Identity and naming

Item IDs use **BI** for **Bench Intake**: `BI-001`, `BI-002`, and so on. Allocate the next unused positive number, padded to at least three digits, after checking this index and Git history. Never reuse an ID or encode type, priority or status in it. The numeric portion can grow beyond three digits.

Every OpenSpec change has one short descriptive kebab-case name, such as `add-bulk-lot-editing`. Use that exact canonical name for its active change directory (native archives may add a date prefix), all branches that deliver it, and its commit/PR subjects. For example, `feat/add-bulk-lot-editing-validation` and `feat(add-bulk-lot-editing): validate bulk edits`. Keep the name stable once referenced; it identifies the change while BI identifies an index item. Several related items may point to one cohesive change.

## Item format and grouping

Group items by type below, then by **Critical**, **High**, **Normal**, **Low**, **Unassessed** priority. Add priority subheadings only where populated. Priority expresses importance, not a delivery date.

```markdown
### High

#### BI-001 — Bulk lot editing

A two-to-five sentence description of the problem and intended outcome. Explain the relevant scope or limitation.

- Change: `add-bulk-lot-editing`
- Status: In review
- Size: Unknown
- Prerequisites: Unknown — dependencies have not been assessed.
- OpenSpec: [add-bulk-lot-editing](../openspec/changes/add-bulk-lot-editing/)
```

| Field         | Values and meaning                                                                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type          | Feature: new capability; Fix: incorrect behavior; Improvement: better existing behavior; Maintenance: technical upkeep. Choose one primary type.                                                                                                                                       |
| Priority      | Critical: blocks essential use or risks data integrity; High: major impact; Normal: useful standard work; Low: limited impact or polish; Unassessed: importance not yet assessed.                                                                                                      |
| Status        | Proposed: captured, not committed; Planned: accepted for future work; In progress: implementation underway; Blocked: cannot proceed, with a current blocker; In review: implementation awaiting review/checks; Done: accepted and merged with evidence; Cancelled: no longer intended. |
| Size          | XS: localized change; S: small change within one area; M: several related changes; L: substantial cross-area work; XL: broad work needing decomposition; Unknown: not assessed. These are relative estimates, not time commitments.                                                    |
| Prerequisites | Link prerequisite BI items or OpenSpec changes and describe specific external requirements. Use None only after assessment, or Unknown when unassessed. State whether known prerequisites are satisfied.                                                                               |

The index owns current item metadata; OpenSpec artifacts own detailed intent, requirements, design, tasks and PR delivery plans. Keep only current status, size, priority and prerequisites here, with no status history. Retain Done and Cancelled entries unless removal is requested. Done requires acceptance evidence and merged implementation, not merely completed task checkboxes or green CI. Update the OpenSpec link when an authorized archive moves a change.

## Features

### High

#### BI-006 — Agent-led intake

Remove manual lot entry and question-blocked processing from Capture and Processing. One Examine lead session per batch finds each item in the photos and documents, groups those observations into lots (a photo can feed several lots and a lot can span several photos) and identifies each lot; proposed lots appear live and are created as editable drafts. Native Claude and Codex sessions stream status lines, proposals and questions while they work, accept queued answers, chat and new evidence whether running or idle, and resume finished sessions. Reading, sorting and identifying combine into that one Examine stage, and Research and Images run in parallel per lot once its identity is stable.

- Change: `simplify-intake-entry`
- Status: Done — merged in #97, #107, #112 and #118. `native-agent/2` keeps the `native_unverified` label; the live qualification follow-ups are tracked as BI-010 (`harden-native-agent-sessions`).
- Size: XL — agent session protocol and tool server, observation-based lot forming, stage restructuring and live UI, delivered in phased PRs.
- Prerequisites: Native agent integration (`native-agent/1`) is merged; live provider qualification ran on 2026-11-07 (#118) and `native-agent/2` keeps `native_unverified`, so real-provider behavior is not claimed. No dependency on BI-007.
- OpenSpec: [simplify-intake-entry](../openspec/changes/archive/2026-11-07-simplify-intake-entry/)

#### BI-008 — Batch workspace redesign

Adopt the Bench Intake Design System (tokens, light and dark themes, components, content rules) and masthead option A, and restructure the batch into Capture, Processing, Review and Changes with a second tab row and a need-you panel. Review gains Lots, Map and Records with record-level edits; Changes combines Ready to add (By type and Tree) and Added; an app-level Agents page lists sessions. A styling uplift then moves the remaining styling onto the design system's tokens and shared components, gives each component the design system's name, and closes the visual and structural gaps against the canvas, including the corrections, region edits and data the specs still require.

- Change: `redesign-batch-workspace`
- Status: Done — PR-A to PR-G merged in #96, #100, #102, #104, #108, #109 and #110 (task 14, BI-006 sessions, observations and proposals, in PR-G), the styling uplift and component alignment (tasks 15–20) as PR-H to PR-K in #135, #139, #145 and #146, corrections and region edits (task 21) in #147, the data the specs require (task 22) in #148, and the remaining canvas detail (task 23) in #170. Re-sending a value InvenTree refused stays with executor follow-up work (design D7).
- Size: XL — design system, navigation, every batch screen and a record-edit backend, delivered in fourteen PRs (PR-A to PR-N).
- Prerequisites: None to start. Agent-backed panels (sessions, live lots, region-level Map) arrive with BI-006 and fall back to retained jobs until then.
- OpenSpec: [redesign-batch-workspace](../openspec/changes/archive/2026-11-09-redesign-batch-workspace/)

### Unassessed

#### BI-015 — Design refresh backend follow-ups

Build the backend for the design-refresh controls that BI-014 ships disabled. That covers agent model per step, instructions copied into every new batch, web research switches, app-level batch defaults and the rules agents follow when writing descriptions. It also covers description fields for new companies, manufacturer parts, supplier parts, locations, categories and parameter templates, and reading existing manufacturer and supplier part descriptions. The rest is the InvenTree token row, connection check and import reference prefix in Settings, deleting written batch notes, and fuller existing-stock data for the Inventory duplicate comparison.

- Change: `complete-design-refresh-backend`
- Status: Proposed
- Size: Unknown
- Prerequisites: BI-014 (`apply-design-refresh`) ships the disabled controls first; not yet satisfied (BI-014 is Planned).
- OpenSpec: [complete-design-refresh-backend](../openspec/changes/complete-design-refresh-backend/)

#### BI-004 — Automatic supplier logos

Find a suitable supplier logo automatically when creating a supplier. This is a minimal future-work placeholder; the Batch settings overhaul shows a disabled Find automatically checkbox with a coming-soon explanation, and no proposal is planned yet.

- Change: `automatic-supplier-logos`
- Status: Proposed
- Size: Unknown
- Prerequisites: Unknown — discovery sources, image handling and execution support need assessment; BI-003 supplies the planned entry point as a disabled Find automatically control; automatic discovery is not implemented.
- OpenSpec: [automatic-supplier-logos](../openspec/changes/automatic-supplier-logos/)

#### BI-005 — Purchase-order support

Enable purchase-order creation from retained batch supplier and order context through explicit review, approval and supervised execution. Assess order numbering, dates, line mapping, duplicate prevention and uncertain-result recovery before enabling the currently disabled controls.

- Change: `purchase-order-support`
- Status: Proposed
- Size: Unknown
- Prerequisites: Unknown — compatibility and execution support need assessment; BI-003 prepares the planned UI, while actual PO operations remain unsupported.
- OpenSpec: [purchase-order-support](../openspec/changes/purchase-order-support/)

#### BI-007 — Antigravity agent provider

Add Google Antigravity (`agy` CLI) as a third native agent provider beside Claude and Codex. The CLI offers stream-JSON, an ACP server, conversation resume and MCP, but no confirmed way to disable its built-in tools, so a lockdown spike would have had to come first.

- Change: `antigravity-agent-provider`
- Status: Cancelled — no longer planned.
- Size: Unknown
- Prerequisites: A tool-lockdown spike (not started) and BI-006's session protocol and tool server (Done).
- OpenSpec: None — no change is registered.

## Fixes

### High

#### BI-010 — Harden native agent sessions

BI-006's live qualification (#118) found that a native Codex session is not confined to the intake tools. Codex wraps them inside its `exec` JavaScript tool, also offers its collaboration, clock, `apply_patch` and `image_gen` tools, and loads the user-level skills catalogue, and neither the start-time check nor the in-run check catches this. Real models also stumble on `propose`, whose rejection does not name the failing field. A session cannot cite evidence it picks up mid-session, because no digest is delivered with it. Fix these, detect or exclude Claude's deferred `advisor` tool, and correct the qualification script's chat detection, then re-run the live qualification so `native-agent/2` can drop `native_unverified`.

- Change: `harden-native-agent-sessions`
- Status: Blocked — tool admission, actionable tool results, retained failure details and the live qualification merged in #133, #134, #137 and #141. Claude Haiku qualified apart from partial status cadence, but Codex still receives code-mode tools on subscription turns, so `native-agent/2` keeps `native_unverified`. Continuing needs a decision on how to detect or refuse that Codex surface.
- Size: M — adapter tool confinement and checks for both providers, validation messages, a digest in the evidence delivery, and a re-run of the qualification.
- Prerequisites: BI-006 is Done (satisfied). Live qualification was authorized for Claude Haiku and GPT 6 Luna on 2026-11-07; any further live run needs fresh authorization.
- OpenSpec: [harden-native-agent-sessions](../openspec/changes/harden-native-agent-sessions/)

## Improvements

### High

#### BI-014 — Design refresh

Carry the refined design and design system into the app: a calmer masthead and batch header (one attention count, tabs left of the title, server menu holding Open InvenTree, Settings gear), short source chips with details in a popover, help buttons instead of helper text, a purple AI mark at agent touchpoints, and InvenTree descriptions where the app can show them. It adds a Settings page, a Processing › Inventory step page, Review › Records · Locations, and a slim phone header that condenses on scroll. Capture uploads start as soon as files are picked, and evidence can be deleted with undo. Controls that need new backend work ship disabled and are tracked as BI-015.

- Change: `apply-design-refresh`
- Status: Planned
- Size: XL — every batch screen, the header, a new Settings page and one append-only removal backend, in seven PRs (PR-A to PR-G).
- Prerequisites: BI-008 (`redesign-batch-workspace`) is Done; its delta specs must be archived before this change syncs.
- OpenSpec: [apply-design-refresh](../openspec/changes/apply-design-refresh/)

### Normal

#### BI-009 — Local development InvenTree

Developers have no real InvenTree to run Bench Intake or the importer against locally; the only options are the fake inventory or a read-only external server. Add a repository-owned Docker Compose stack, built on the pinned local InvenTree image, that starts in a ready state with generated credentials and API tokens, seeded from the importer config and a small fixture. The intake app's dev databases move onto that stack's own PostgreSQL (`inventree-db`). `pnpm dev` starts the stack when `INTAKE_TARGET_PROFILE=local-inventree`.

- Change: `local-inventree-dev`
- Status: Done — merged in #105
- Size: L — Compose stack and bootstrap, a database move, seeding, a new dev target profile and docs.
- Prerequisites: Docker with Compose 2.24 or later, and the pinned `inventree/inventree` stable image, which is present locally. No BI item dependencies.
- OpenSpec: [local-inventree-dev](../openspec/changes/archive/2026-11-07-local-inventree-dev/)

#### BI-012 — Improve Markdown readability

Repository Markdown is uneven. Some documents are long unbroken paragraphs, heading depth differs between similar documents, and an earlier pass (#44) only made the intake guidance and safety contracts easier to read. Improve readability and structure across the remaining repository Markdown, including architecture notes, OpenSpec artifacts and contributor docs, without changing the meaning of requirements or implementation records. Keep generated files, preserved evidence and historical permalinks stable. This is a documentation pass, not a product behavior change.

- Change: `improve-markdown-readability`
- Status: Proposed
- Size: L — a repository-wide documentation pass across several areas, not one file.
- Prerequisites: None. The earlier intake readability pass (#44) is already merged and is not a blocker. No BI item has to land first.
- OpenSpec: [improve-markdown-readability](../openspec/changes/improve-markdown-readability/)

### Unassessed

#### BI-013 — Preview renditions for media

Every image in the app is served as the full-resolution decoded PNG, often several megabytes, even for 44 px thumbnails, so pages load slowly, especially on a phone over Tailscale. The decoder should also produce smaller WebP preview sizes for each page and documentary crop. Observation crops should be served at those sizes too, and each frontend surface should load the size it needs. Crops stay cut from the retained original or its full-resolution page, never from a reduced preview. Already-retained media is upgraded in the background.

- Change: `add-preview-renditions`
- Status: Done — merged in #140, #143 and #144.
- Size: L — decoder, storage, routes, a background backfill and several frontend surfaces.
- Prerequisites: None. Frontend edits landed alongside `redesign-batch-workspace`; that restyling was not a blocker.
- OpenSpec: [add-preview-renditions](../openspec/changes/archive/2026-11-09-add-preview-renditions/)

#### BI-001 — Capture tab uplift

Consolidate all settings currently reached through the Shared details buttons into one Batch settings panel and remove those buttons. Include the original mockup's elements with PO controls disabled and greyed out, and compare right-side versus above-content placement before choosing the layout. Uplift the main evidence panel with three prominent top actions for taking photos, adding documents and writing notes, and organize evidence using groups like the original mockup.

- Change: `capture-tab-uplift`
- Status: Done
- Size: L — retained settings/context and group/note contracts, UI consolidation and responsive evidence qualification.
- Prerequisites: None external identified — existing media/groups and form/revision infrastructure are available; the change includes missing context/group contracts and dependency qualification. PO controls remain disabled; no dependency on BI-002.
- OpenSpec: [capture-tab-uplift](../openspec/changes/archive/2026-11-04-capture-tab-uplift/)

#### BI-002 — Status signalling uplift

Replace the top-right Manual workflow element with a clickable connection-status indicator that reveals connection details, with an Open InvenTree link to its right as in the original mockup. Add a distinct workflow status/actions indicator on the same header row, using the mockup's Processing in progress state as the reference. Expanding it should show current work status and steps, relevant actions and active agents while keeping connection health separate from workflow progress.

- Change: `status-signalling-uplift`
- Status: Done
- Size: L — cross-layer target/work read contracts, accessible header integration and browser qualification.
- Prerequisites: None external identified — existing retained data and target transport are available; the change includes its read-contract and package-qualification foundations. No ordering dependency on BI-001.
- OpenSpec: [status-signalling-uplift](../openspec/changes/archive/2026-11-04-status-signalling-uplift/)

#### BI-003 — Batch settings overhaul

Replace technical selection modes and explicit settings saves with concise reusable inputs and safe autosave. Add optional batch/order notes, typo-tolerant searchable default-location and supplier selection with new-record drafts, reviewed evidence-derived quantities, order/date choices, shared Part tags and Custom instructions. Remove the Physical lots and Part proposals panes from Capture and default to the original mockup layout. Preserve explicit location precedence and keep PO creation and automatic logo discovery disabled for separate future work.

- Change: `batch-settings-overhaul`
- Status: Done
- Size: L — cross-layer settings, search, inheritance, inference preferences and supervised new-record support.
- Prerequisites: BI-001 and BI-002 are satisfied; existing capture, review and transport foundations are merged. New catalogue and new-record execution contracts are included in this change; future PO and logo items are not prerequisites.
- OpenSpec: [batch-settings-overhaul](../openspec/changes/archive/2026-11-05-batch-settings-overhaul/)

## Maintenance

### Normal

#### BI-011 — Remove unused legacy code

Sweep the backend, frontend, contracts, scripts and skills for unused legacy code and remove it. Candidates include superseded components, compatibility shims, fallback adapters and dead configuration; old-link redirects that a current spec requires stay unless that spec changes. The app has essentially one user, so backwards compatibility is not a goal in itself. Keep a legacy path only where a database migration cannot preserve data records that continuing functionality needs; otherwise migrate the data and delete the old path. Code kept for a planned item is not legacy and stays.

- Change: `remove-unused-legacy-code`
- Status: Proposed
- Size: Unknown
- Prerequisites: Unknown — not assessed. Running it after BI-008's styling uplift (PR-K), which retires the legacy UI primitives itself, would avoid overlapping that work.
- OpenSpec: [remove-unused-legacy-code](../openspec/changes/remove-unused-legacy-code/)

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

Remove manual lot entry and question-blocked processing from Capture and Processing. An agent sorts batch evidence into proposed lots that appear live and are created as editable drafts. Native Claude and Codex sessions stream status lines, proposals and questions while they work, accept queued answers, chat and new evidence whether running or idle, and resume finished sessions. Reading and identifying combine into one Examine stage, and Research and Images run in parallel after it.

- Change: `simplify-intake-entry`
- Status: Planned
- Size: XL — agent session protocol and tool server, batch sorting, stage restructuring and live UI, delivered in phased PRs.
- Prerequisites: Native agent integration (`native-agent/1`) is merged; live provider qualification is still pending and is required before claiming real-provider behavior. No dependency on BI-007.
- OpenSpec: [simplify-intake-entry](../openspec/changes/simplify-intake-entry/)

### Unassessed

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

Add Google Antigravity (`agy` CLI) as a third native agent provider beside Claude and Codex. The CLI offers stream-JSON, an ACP server, conversation resume and MCP, but no confirmed way to disable its built-in tools, so a lockdown spike must come first. This is a minimal placeholder; no proposal is planned yet.

- Change: `antigravity-agent-provider`
- Status: Proposed
- Size: Unknown
- Prerequisites: Tool-lockdown spike not started; BI-006's session protocol and tool server should land first so the adapter targets one provider interface.
- OpenSpec: [antigravity-agent-provider](../openspec/changes/antigravity-agent-provider/)

## Fixes

No registered items.

## Improvements

### Unassessed

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

No registered items.

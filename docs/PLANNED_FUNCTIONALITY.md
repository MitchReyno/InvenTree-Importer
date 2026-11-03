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

No registered items.

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
- OpenSpec: [capture-tab-uplift](../openspec/changes/capture-tab-uplift/)

#### BI-002 — Status signalling uplift

Replace the top-right Manual workflow element with a clickable connection-status indicator that reveals connection details, with an Open InvenTree link to its right as in the original mockup. Add a distinct workflow status/actions indicator on the same header row, using the mockup's Processing in progress state as the reference. Expanding it should show current work status and steps, relevant actions and active agents while keeping connection health separate from workflow progress.

- Change: `status-signalling-uplift`
- Status: In review
- Size: L — cross-layer target/work read contracts, accessible header integration and browser qualification.
- Prerequisites: None external identified — existing retained data and target transport are available; the change includes its read-contract and package-qualification foundations. No ordering dependency on BI-001.
- OpenSpec: [status-signalling-uplift](../openspec/changes/status-signalling-uplift/)

## Maintenance

No registered items.

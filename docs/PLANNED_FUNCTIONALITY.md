# Planned interactive app functionality

This register tracks requested future features, fixes and improvements for the interactive app on `interactive-app`. It describes plans, not implemented behavior or release commitments. No items have been registered yet.

Maintain this register with the project-level `planned-functionality` skill. Each item has a detail file in [planned-functionality/](planned-functionality/README.md); use the [detail template](planned-functionality/TEMPLATE.md). Existing delivery plans remain responsible for implementation sequencing and acceptance evidence. For requested detailed planning, see the [Bench Intake OpenSpec workflow](openspec.md). Capturing an item alone does not start that workflow.

## Item conventions

Use **BI** for **Bench Intake**. Assign the next unused positive number, padded to at least three digits, such as `BI-001`; numbers may grow beyond three digits. Never reuse an ID or encode type, priority or status in it. Group items under the type headings below, then under priority subheadings in this order: **Critical**, **High**, **Normal**, **Low**, **Unassessed**. Create priority subheadings only when they contain items. Priority expresses relative importance, not a delivery date.

Each entry uses this format:

```markdown
### High

#### BI-001 — Item title

A two-to-five sentence description of the problem and intended outcome. Explain the relevant scope or limitation.

- Status: Proposed
- Size: Unknown
- Prerequisites: Unknown — dependencies have not been assessed.
- Details: [BI-001 — Item title](planned-functionality/BI-001-item-slug.md)
```

The heading in this example assumes it sits under an item's type section. Keep the title, type, priority, status, size and prerequisites consistent with its detail file.

| Field         | Values and meaning                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type          | Feature: new capability; Fix: incorrect behavior; Improvement: better existing behavior; Maintenance: technical upkeep. Choose one primary type.                                                                                                                                      |
| Priority      | Critical: blocks essential use or risks data integrity; High: major impact; Normal: useful standard work; Low: limited impact or polish; Unassessed: importance not yet assessed.                                                                                                     |
| Status        | Proposed: captured, not committed; Planned: accepted for future work; In progress: implementation underway; Blocked: cannot proceed, with a stated blocker; In review: implementation awaiting review/checks; Done: accepted and merged with evidence; Cancelled: no longer intended. |
| Size          | XS: localized change; S: small change within one area; M: several related changes; L: substantial cross-area work; XL: broad work needing decomposition; Unknown: not assessed. These are relative estimates, not time commitments.                                                   |
| Prerequisites | Link prerequisite BI IDs or specific external requirements. Use None only when assessed to have no prerequisites; use Unknown when unassessed. State whether a known prerequisite is satisfied.                                                                                       |

Keep only the current status, size, priority and prerequisites. Replace outdated values; Git records history. Retain Done and Cancelled entries for reference unless explicitly asked to remove them; they are no longer future commitments. Mark Done only when the detail file links evidence that the acceptance criteria were met and the implementation merged into the app trunk.

## Features

No registered items.

## Fixes

No registered items.

## Improvements

No registered items.

## Maintenance

No registered items.

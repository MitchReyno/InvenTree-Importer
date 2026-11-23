# Implementation notes

Implementation of the UI polish and calm loading plan, delivered as PR-A to PR-I after the plan PRs (#247, #248). PR-A is underway; PR-B to PR-I remain.

## Changes to the plan

None yet.

## Unexpected challenges

- **Task 2 (PR-A):** `screenshots:frontend` cannot capture `header-disclosure`: Public Sans never loads on that fixture, before and after this change. The other ten fixture pages are compared.

## Decisions made during implementation

- **2026-11-23T19:36+11:00, task 8 (PR-A):** Settings › Agents and the other Settings sections keep their row descriptions (`SettingRow` `help`, `SettingsSection` `lead`) as visible text. They are the design system's row-description pattern, not standing explanations under a heading; the sweep moved only Processing, Agents and Review text. "Not supported yet" reasons, legends of table marks and consequences of an action stay visible.
- **2026-11-23T19:36+11:00, task 8 (PR-A):** `Popover` chooses its alignment when it opens (`chooseAlign`): it keeps the preferred edge while that side of the trigger has room and otherwise opens from the trigger's other edge, rather than letting the window edge push the panel away. The panel's width is read as it attaches, before Radix caps it to the room on the aligned side. Rejected: setting `align="start"` on the need-you panel only, which would leave every other popover with the same trap.

## Open items

None yet.

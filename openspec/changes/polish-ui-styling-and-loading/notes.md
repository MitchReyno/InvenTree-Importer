# Implementation notes

Implementation of the UI polish and calm loading plan, delivered as PR-A to PR-I after the plan PRs (#247, #248). PR-A is underway; PR-B to PR-I remain.

## Changes to the plan

None yet.

## Unexpected challenges

- **2026-11-24T02:56+11:00, task 9 (PR-E):** The Capture fixtures' media clients refuse uploads on purpose, so the drop and paste checks and the demo used a throwaway copy of `GroupedCaptureProof` with a slowed in-memory upload, not committed. Headless browsers have no file manager or clipboard files, so drops and pastes were dispatched with a real `DataTransfer` of files. The installed Playwright has no matching WebKit build, so desktop Safari was not checked.
- **Task 2 (PR-A):** `screenshots:frontend` cannot capture `header-disclosure`: Public Sans never loads on that fixture, before and after this change. The other ten fixture pages are compared.

## Decisions made during implementation

- **2026-11-23T19:36+11:00, task 8 (PR-A):** Settings › Agents and the other Settings sections keep their row descriptions (`SettingRow` `help`, `SettingsSection` `lead`) as visible text. They are the design system's row-description pattern, not standing explanations under a heading; the sweep moved only Processing, Agents and Review text. "Not supported yet" reasons, legends of table marks and consequences of an action stay visible.
- **2026-11-23T19:36+11:00, task 8 (PR-A):** `Popover` chooses its alignment when it opens (`chooseAlign`): it keeps the preferred edge while that side of the trigger has room and otherwise opens from the trigger's other edge, rather than letting the window edge push the panel away. The panel's width is read as it attaches, before Radix caps it to the room on the aligned side. Rejected: setting `align="start"` on the need-you panel only, which would leave every other popover with the same trap.
- **2026-11-24T02:48+11:00, task 9 (PR-E):** A paste is left alone inside a dialog as well as inside text fields. The file viewer and the crop dialog are modal, and a screenshot pasted while one is open would otherwise land in Ungrouped behind it.
- **2026-11-24T02:48+11:00, task 9 (PR-E):** A refused drop or paste shows its reason in a dismissable warning on the evidence panel, which clears on the next accepted drop or paste. The capture tiles had no reason to reuse, so this is the panel's own line. A refused drop is still taken by the target, so the browser doesn't open the file instead. The gate checks an archived batch itself rather than relying on Capture's `disabled`, so it names the reason.

## Open items

- **2026-11-24T02:56+11:00, task 9 (PR-E):** Task 9.4's phone checks (iOS Safari and Android Chrome: Take photos offers the camera and the library, and the library picks several photos) and the desktop Safari drop and paste check are for Mitch to run on real devices. The Camera / Photo library fallback is added only if a phone's sheet lacks one route.

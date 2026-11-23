## ADDED Requirements

### Requirement: Several photos from a phone in one go

On a phone, Take photos SHALL offer both the camera and the photo library, and the library SHALL allow picking several photos at once. The picker SHALL NOT be limited to taking one photo with the camera.

#### Scenario: Pick five photos from the library

- **GIVEN** an editable batch opened on a phone
- **WHEN** the operator chooses Take photos, picks the photo library and selects five photos
- **THEN** all five start uploading together into the chosen group, one after another, as for any multi-file pick.

#### Scenario: Camera still available

- **GIVEN** the same phone
- **WHEN** the operator chooses Take photos and picks the camera
- **THEN** the camera opens, and each photo taken uploads like a picked file.

### Requirement: Drop or paste files to add evidence

Files dropped onto the evidence panel or onto one of its groups, or pasted while Capture has focus, SHALL upload exactly as if picked: as one operation for all the files, photos and documents together, into the group they were dropped on (or the batch's ungrouped evidence), under the same limits, states and refusal conditions as the picker. While files are dragged over it, the target SHALL show where they will go. Unsupported files SHALL show "Not added" with the reason, as for picked files.

#### Scenario: Drop three photos and a PDF on a group

- **GIVEN** Capture on a desktop browser with a group "Resistor packets"
- **WHEN** the operator drags three JPEGs and a PDF from the file manager onto that group
- **THEN** the group highlights while they hover, and on drop all four upload into it one after another, showing "Uploading 2 of 4".

#### Scenario: Paste a screenshot

- **GIVEN** Capture with focus outside a text field, and an image on the clipboard
- **WHEN** the operator pastes
- **THEN** the image uploads into the ungrouped evidence; pasting inside a note's text field still pastes text into the note.

#### Scenario: Drop while media is unavailable

- **GIVEN** media disabled, the batch archived, media state not yet current, a command pending or a conflicting draft open
- **WHEN** files are dropped on the panel or pasted
- **THEN** nothing uploads, and the panel says why, as the picker's disabled actions do.

#### Scenario: A drop on a group inside the panel

- **GIVEN** a group inside the evidence panel
- **WHEN** files are dropped on the group
- **THEN** they upload once, into that group, and the panel does not also take them.

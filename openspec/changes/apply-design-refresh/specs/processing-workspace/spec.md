# Capability delta

## ADDED Requirements

### Requirement: Inventory step page

Processing › Inventory SHALL follow the step page pattern. The main column SHALL list:

- each lot's Part match and why;
- possible duplicate stock as a side-by-side comparison of the lot and the existing stock item, built from the retained question;
- location and company matches, linking to Review › Records.

The session drawer SHALL show the selected Inventory session's timeline, its open question as option cards with Answer, and the message box. Fields the retained data doesn't hold SHALL read "Not known" rather than being invented.

#### Scenario: Duplicate stock question

- **GIVEN** Inventory asked whether a tube is existing stock #1712
- **WHEN** the operator opens Processing › Inventory
- **THEN** the comparison shows both records' Part, date code, location and quantity, and answering in the drawer resolves the question

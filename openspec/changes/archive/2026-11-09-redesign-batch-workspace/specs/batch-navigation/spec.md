# Capability delta

## Purpose

A batch has four tabs, each with one job: Capture gives, Processing works, Review checks, Changes commits. Their sub-views are visible enough that nobody misses a screen that needs them, and existing links keep working.

## ADDED Requirements

### Requirement: Four batch tabs

The batch header SHALL show the tabs Capture, Processing, Review and Changes, each with a count and an attention badge from retained reads. Review SHALL show both lots to check and record decisions. Approve and Results SHALL no longer be tabs.

#### Scenario: Header on any tab

- **GIVEN** a batch with 3 open questions, 8 lots to check, 3 record decisions and 6 lots ready to add
- **WHEN** any batch tab is open
- **THEN** the tabs read Processing “3 questions”, Review “8 to check · 3 to decide” and Changes “6 ready”, with warning badges visually distinct from plain counts.

### Requirement: Second tab row

Processing, Review and Changes SHALL each show their sub-views as a second row of tabs inside the header band. Each sub-view SHALL have its own count and attention badge:

- **Processing:** Overview · Examine · Research · Images · Inventory.
- **Review:** Lots · Map · Records.
- **Changes:** Ready to add · Added.

Segmented controls SHALL be used only for different views of the same list (Workspace | Table, By type | Tree), never for separate screens.

#### Scenario: Hidden screen is noticed

- **GIVEN** Review with 3 record decisions pending
- **WHEN** the operator is on Review › Lots
- **THEN** the second row shows Records with a “3 to decide” warning badge without opening it.

### Requirement: Need-you panel

The batch header SHALL show a "N need you" pill that opens a panel listing every open item in the batch, grouped by the owning tab:

- questions;
- lots changed since review;
- record decisions;
- failed or uncertain results.

Each item SHALL link to its owning screen. The panel SHALL be keyboard operable and dismiss with Escape, returning focus to the pill.

#### Scenario: Open an item

- **GIVEN** the panel lists a failed attachment
- **WHEN** the operator selects it
- **THEN** Changes › Added opens with that record focused.

### Requirement: Legacy approval and results links redirect

Old approval and results links SHALL redirect through the navigation guard, without losing dirty drafts: `#<batch>/approve[/<preparation>]` to `#<batch>/changes/ready[/<preparation>]`, and `#<batch>/results[/<run>]` to `#<batch>/changes/added[/<run>]`. A pinned preparation or run identity SHALL be preserved exactly.

#### Scenario: Old approval link

- **GIVEN** a bookmarked approval link pinned to preparation P
- **WHEN** it is opened
- **THEN** Changes › Ready to add opens pinned to P, and a stale P stays disabled exactly as before.

### Requirement: Legacy review links redirect

Old review links SHALL redirect through the navigation guard: `#<batch>/review` to `#<batch>/review/lots`, and `#<batch>/review/<lot>` (where `<lot>` is not `lots`, `map` or `records`) to `#<batch>/review/lots/<lot>`.

#### Scenario: Old lot link

- **GIVEN** a bookmarked link to lot L in Review
- **WHEN** it is opened
- **THEN** Review › Lots opens with L selected.

### Requirement: Legacy processing links redirect

Old processing links SHALL redirect through the navigation guard: `#<batch>/processing` to `#<batch>/processing/overview`, and `#<batch>/processing/reading[/<question>]` or `#<batch>/processing/identifying[/<question>]` to `#<batch>/processing/examine[/<question>]`.

#### Scenario: Old question link

- **GIVEN** a link to question Q under `processing/identifying`
- **WHEN** it is opened
- **THEN** Processing › Examine opens with Q selected.

### Requirement: Redirects keep the query string

Every legacy redirect SHALL carry the query string over unchanged, including filters, the open editor and pinned evidence parameters.

#### Scenario: Old review link with pinned evidence

- **GIVEN** a link `#<batch>/review/<lot>?source=S&version=V&page=2`
- **WHEN** it is opened
- **THEN** Review › Lots opens on that lot with the same source, version and page pinned.

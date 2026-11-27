## ADDED Requirements

### Requirement: Independently ready page regions

The inbox, Processing Overview, Agents, and the affected Settings and Records panels SHALL display each independently available region as its authorized data becomes available. Each dependent region SHALL distinguish loading, empty and unavailable. Refresh or failure in one region SHALL preserve usable siblings, drafts, keyboard focus and existing command freshness rules.

#### Scenario: Inbox enrichment is slow

- **GIVEN** a cold inbox with a completed first page of batch identities and delayed workflow summaries
- **WHEN** titles become available
- **THEN** those titles and navigation links appear immediately while the corresponding summary fields retain their loading placeholders
- **AND** the generic batch link keeps its focus and destination when enrichment arrives, and the contextual resume action appears once its destination is known
- **AND** changing page or search cannot apply the previous page's summary to the new rows

#### Scenario: Processing reads finish in different orders

- **GIVEN** an authorized batch and an open Processing Overview
- **WHEN** Recent activity is ready while the Processing snapshot remains pending
- **THEN** activity is readable while job and question regions retain their own placeholders
- **AND** if activity fails after jobs arrive, the current jobs stay visible and retry targets activity

#### Scenario: Optional detail fails during editing

- **GIVEN** an operator editing a saved setting or record while optional detail loads
- **WHEN** the auxiliary read fails and is retried
- **THEN** the form retains its input and focus, the affected region announces its status, and unrelated actions retain their existing eligibility

#### Scenario: Session list arrives before capacity

- **WHEN** the Agents page has an authorized session list while settings are pending
- **THEN** rows and group links are usable and the capacity limit stays unknown until its own read succeeds

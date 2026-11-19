# complete-design-refresh-backend

Backend for the design-refresh controls that `apply-design-refresh` ships disabled. `settings-debug-mode` (BI-016) takes over most of the Settings rows; this change keeps:

- the Settings › Agents web research switches;
- the per-record "Fill descriptions for" switches, the supplier part description source and "Tag every Part with its batch name";
- description fields for manufacturer parts, supplier parts and agent-proposed companies, categories and parameter templates;
- reading existing manufacturer part, supplier part and location type descriptions;
- deleting written batch notes;
- Inventory questions that carry the session's answer options (for the drawer's option cards) and the existing record's fields (for the Inventory comparison).

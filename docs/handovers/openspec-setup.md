# OpenSpec setup

## Plan and scope

Preserve the user's OpenSpec 1.16.0 initialization as a separate setup PR targeting `interactive-app`. Generated files were moved intact from the planning-register worktree so that register publication and setup compatibility can be reviewed independently. The initialized configuration uses `spec-driven`, with empty specs/changes and no implementation authorization.

The generated `.agents` and `.claude` skill trees differ only in invocation examples, but repository guidance requires identical copies. Preserve Claude examples and add shared invocation notes mapping them to project-level skills; preserve native Claude command files. OpenSpec's `.openspec-target` is host ownership metadata at the skill root, not an authored skill resource. Exclude only that root marker from workflow-copy comparisons, with a regression that ensures identically named files inside skills remain compared.

No new runtime dependencies are needed. The user installed the CLI globally. Retain generated version/license metadata; document how `openspec update` affects local adaptations. Link the register and OpenSpec through references rather than duplicating priority/status ownership. Do not create feature proposals, implement features, invoke providers or touch inventory.

## Validation and review plan

- Normalize generated Markdown with existing remark, check portability, and compare every mirrored skill file byte-for-byte.
- Run focused workflow-sync regression tests and Python lint; verify `openspec list --json` recognizes the initialized empty workspace.
- Run selected CI and fresh independent read-only review of the exact head before PR publication and merge. Record findings and evidence here.

## Current result

All six generated skills are mirrored as identical real copies. Each keeps the generated Claude command examples and adds an invocation note mapping only its referenced commands to project-level skill names. Native Claude commands remain separate. The workflow-copy helper excludes only root `.openspec-target`; its regression proves a nested same-name authored resource still participates in comparisons.

Validation: all changed Markdown passes remark; all six skill directory comparisons pass; workflow sync passes 8 tests including the new marker boundary regression; Ruff passes for the changed Python test. OpenSpec 1.16.0 recognizes the empty project, and `openspec validate --all` reports no items to validate, not qualification of any feature spec. The immediately preceding register task ran normal frontend/contracts/intake and backend suites; only the two generated-copy checks failed after initialization, and this setup's focused check now passes. No new full-suite local pass is claimed for setup; hosted selected CI remains required.

Independent exact-head review and PR publication are pending. The setup creates no feature proposals and executes no application/provider/inventory operations.

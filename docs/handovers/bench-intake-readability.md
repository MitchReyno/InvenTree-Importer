# TypeScript readability checks

## Prospective plan

The user asked for readable new TypeScript, blank lines between functions, clearer guidelines and concrete patterns to avoid. The coordinator assigned this independent task after the typed-query uplift merged. This record precedes code, configuration and dependency changes.

Scope: a shared focused ESLint readability configuration, application/root command and CI integration, meaningful rule fixtures, and the shared/frontend/server guidelines. Preserve Prettier as the single formatter. Existing recommended frontend correctness rules remain in place. Do not change feature behavior, retained bytes, generated contracts, immutable migrations, preserved design references or another owner's worktree.

First inspect installed maintained rules and quantify the current baseline. Prefer ESLint Stylistic spacing rules over deprecated core style rules. Check separation of functions and class methods, readable declarations and branch braces; retain TypeScript overload groups. Do not claim object-method coverage without a verified rule. Function size and conceptual density remain responsibility-based review checks, without arbitrary line quotas.

Dependencies under assessment are root development tooling only: ESLint 10.14.0, typescript-eslint 8.72.1 and ESLint Stylistic 5.10.0, matching the existing frontend versions where applicable. Verify actual published engines, peer compatibility, license and rule behavior before installation. A small custom rule is an alternative only if maintained rules cannot express a demonstrated requirement; it is not the default.

The coordinator retains media, processing, forms, public contract generation and application shell integration. This owner works only in its independent branch. Any baseline source cleanup will be mechanical and narrowly scoped to violations reported by the new checks, after reporting its size to the coordinator. Do not modify sibling branches or import their unpublished implementation.

## Implementation sequence

1. Read the approved implementation plan, application boundaries and existing formatter/lint/CI configuration.
2. Research maintained rule APIs, record exact package decisions and establish a violation baseline.
3. Add the shared check and command/CI wiring; coordinate and apply the minimum required mechanical baseline changes.
4. Include the coordinator's user-requested explicit avoid-pattern guidelines, clarifying what tooling enforces and what independent review must assess.
5. Test rule failures and fixes, overload exceptions, Prettier stability, application checks, generated-byte invariants and CI path selection. Run the normal suite required by project guidance.
6. Record results and limitations, publish a ready PR into interactive-app, then transfer to a fresh independent reviewer through the coordinator. Do not self-clear or merge.

## Safety and verification boundaries

No PostgreSQL service, browser, provider or inventory calls are needed. The original environment's real InvenTree remains strictly read-only, with no mutation or denial probes. No credentials are copied or displayed. Preserve all existing worktrees and staged/unstaged/untracked data.

## Research and decisions

Pending authoritative-source and installed-API inspection.

## Results and review

Pending implementation and qualification.

### Package and rule decision

Published metadata confirms ESLint Stylistic 5.10.0 is MIT, supports ESLint 9/10 and the pinned Node 24.22.2. ESLint 10.14.0 and typescript-eslint 8.72.1 match the existing frontend and support the declared TypeScript 6.0.3. Root tooling adds only the Stylistic package's new transitive parser/visitor-key versions; existing workspace packages are reused where compatible.

The current documentation site describes a later beta, so the implementation was checked against the exact installed 5.10.0 rule source and schema. Its padding rule supports AST selectors, allowing ordinary/exported function declarations and direct arrow/function-expression variable initializers without matching nested callbacks. Its class rule supports method-only spacing and an overload exception. Exported overloads needed an explicit selector exception; the adverse fixture failed before that correction and passes afterwards.

Authoritative references: [padding-line-between-statements](https://eslint.style/rules/padding-line-between-statements), [lines-between-class-members](https://eslint.style/rules/lines-between-class-members), and exact registry metadata for [Stylistic 5.10.0](https://registry.npmjs.org/@stylistic/eslint-plugin/5.10.0), [ESLint 10.14.0](https://registry.npmjs.org/eslint/10.14.0) and [typescript-eslint 8.72.1](https://registry.npmjs.org/typescript-eslint/8.72.1).

Use maintained rules rather than a custom AST plugin. Object-method spacing remains an explicit manual review check because the maintained class-member rule does not inspect object literals. No unsupported coverage is claimed.

### Baseline and coordination

Before any runtime source normalization, the new rules reported 251 violations across 48 files: 153 callable spacing, 85 branch braces, 10 class-method spacing and 3 joined variable declarations. The coordinator approved only mechanical normalization in this isolated branch after the form-adoption PR actually merges. Source autofix is held until that merge and a normal merge of actual trunk; no sibling source or owner worktree is being rewritten.

### Check wiring

The root `format:readability` command applies maintained ESLint fixes, followed by ordinary Prettier formatting; its matching check command reports without writing. The root readability command checks runtime frontend, server and contracts TypeScript while excluding generated/vectors/fixtures/migrations. Frontend ESLint imports the same focused configuration alongside its existing correctness rules. A shared local hook and selected TypeScript CI run it; both application paths select the CI check. Rule fixtures run in the same CI job. These additions do not alter Prettier's byte-sensitive ignore policy.

Observed so far: seven rule fixtures and nineteen CI-selector regressions pass. These are fixture/tooling results, not application regression qualification. The mechanical baseline and full normal suite remain pending.


### Installed toolchain qualification

Frozen offline installation passed. All six formatter/hook fixtures pass, including the new actual shared-hook case: condensed callable declarations fail without changing source/index, separated declarations pass, and malformed byte-sensitive fixture/generated source stays excluded and byte-identical. Nineteen CI selectors and changed Python Ruff checks pass. Shared/frontend/server guidelines and this handover pass remark.

The first full formatter-fixture run accidentally let nested script calls resolve an ambient older pnpm, despite invoking the pinned outer binary. That changed a child syntax-error exit from 2 to 1. Re-running with both the pinned Node and pnpm executable directories on PATH passes the original assertion unchanged. The qualification commands must pin nested tools too; no test expectation was weakened.

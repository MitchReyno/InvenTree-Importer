# Markdown lint repair handover

## Goal, base and ownership

Mitch requested that all current Markdown lint issues be fixed narrowly on a separate `fix/markdown-lint` branch based on the consolidated `feat/spike-shared-contracts` commit `e5186c3bbddd5b48298f3a8a1987254b9130e6a8`, not old main. The owned worktree started clean at exactly that commit. All work was confined to that worktree; the integration review worktree, other branches, untracked skills, real local data and existing worktrees were left alone. The latest explicit user instruction selects the spike consolidation base rather than the older initiative-trunk guidance.

Read the current root `AGENTS.md`, `CODE_GUIDELINES.md` and `ARCHITECTURE.md`, plus backend README context, guidelines and architecture. The current checkout uses `CODE_GUIDELINES.md`, not the historical `CONVENTIONS.md` named in inherited context. Loaded `building-skills` before editing skill resources. No architecture boundary or execution behavior changed, so architecture and execution-stage handovers need no update.

## Reproduction and before evidence

The reported CI run `41278139216`, job `124764405205`, identified 27 warnings. A local unmodified-root `pnpm lint:markdown` reproduced exactly those warnings and exited 1:

| Source | Rule | Warnings | Original source lines |
| --- | --- | --- | --- |
| `.agents/skills/chip-logo-identification/data/index_table.md` | `no-undefined-references` | 12 | 7, 11, 22, 35, 135, 230, 250, 275, 322, 407, 430, 437 |
| `.claude/skills/chip-logo-identification/data/index_table.md` | `no-undefined-references` | 12 | Same as the agent copy |
| `backend/README.md` | `no-literal-urls` | 1 | 915 |
| `THIRD-PARTY-NOTICES.md` | `no-literal-urls` | 2 | 9, 39 |

The chip labels are literal manufacturer abbreviations or qualifiers, not missing links. The other three diagnostics concern already-working GFM literal autolinks, including the DigiKey contact email. No additional current warning was discovered locally. The CI identifiers are supplied context; this task reproduced the failures locally rather than re-querying the remote CI job.

## Decisions and narrow changes

- Escape only the opening square bracket in each of the 12 literal labels per mirrored index. This keeps the displayed square brackets and exact text unchanged while making the literal intent explicit. The labels are `ACD`, `ALD`, `EDI`, `KLSI`, `ITEX`, `Micrel`, `CATC`, `White` twice, `LGS` twice and `Micronas Semi`.
- Use the standard email autolink `<api.contact@digikey.com>` in `backend/README.md`. It retains the displayed email and the `mailto:api.contact@digikey.com` destination without displaying a `mailto:` prefix.
- Put angle brackets around the existing upstream repository and license URLs in `THIRD-PARTY-NOTICES.md`. The upstream attribution, complete MIT license block, URL labels, destinations and sentence-ending period remain unchanged.
- Keep both chip-logo skill directories as real, byte-identical copies, including all supporting resources. No skill instructions, agents or workflow semantics changed.
- Add this portable repository handover. No runtime code, UI, dependencies, lockfiles, lint configuration, ignores or hook settings changed. The four repaired source files contain exactly 27 replaced lines: 12 per index, one backend README line and two notices lines. No bulk Markdown formatting was run.

Rejected alternatives: adding fake link definitions would turn literal manufacturer labels into unintended links; removing brackets or replacing them with parentheses would change the rendered reference text; code spans would change typography; renaming URL labels would needlessly change attribution presentation. Disabling rules, adding ignore patterns and broad formatting would hide issues or introduce unrelated churn. Existing documentation-only semantics justify lint, AST and mirror checks instead of inventing runtime tests.

## Validation and after evidence

Used Node `24.22.2`, pnpm `12.16.1` and the existing supplied toolchain on `PATH`. Used the supplied isolated `UV_CACHE_DIR` for workflow synchronization. The initial pnpm command automatically populated the owned worktree's ignored `node_modules` from cached packages (419 reused, zero downloaded); it reported the lockfile up to date. No package or lockfile edits resulted. Workflow synchronization created only the owned backend's ignored virtual environment, using Python `3.12.3`; it did not access credentials or inventory.

| Check | Result |
| --- | --- |
| Unmodified `pnpm lint:markdown` | Exit 1, exactly 27 warnings, matching the supplied diagnostic inventory |
| Repaired `pnpm lint:markdown`, including this handover | Exit 0, no warnings or issues |
| `pnpm workflow-sync` | Exit 0, 7 passed |
| `cmp` of the two edited index files | Exit 0, byte-identical |
| `diff -qr` of both entire chip-logo-identification skill directories | Exit 0, no differences |
| Workflow-sync real-copy assertions | Passed; authored skill paths are not symlinks and all skill files and host-adapted agents remain synchronized |
| Complete GFM AST comparison for all four repaired sources | Passed; identical before/after trees after removing only source positions |
| Focused index assertions | Passed for each mirror: exactly 12 escaped opening brackets, 490 table rows retained, zero links introduced, removing only those escapes recovers the exact original source |
| Focused link assertions | Passed: all three changed links retain exact visible labels and destinations |
| `git diff --check` | Exit 0 |

The semantic check parses `git show HEAD:<file>` and the working copy through the installed `unified`, `remark-parse`, `remark-gfm` and `remark-frontmatter` packages, using the same parsing features as the configured Markdown toolchain. Only `position` fields are removed; node types, children, text, URLs, formatting, table structure, code blocks and all other fields are compared with `assert.deepEqual`. No text or URL normalization is allowed to hide a change. The expected link destinations are `mailto:api.contact@digikey.com`, `https://github.com/inventree/InvenTree` and `https://github.com/inventree/InvenTree/blob/master/LICENSE`; their visible labels are unchanged (the email label has no `mailto:` prefix).

### Reproduce semantic validation

Run this from repository root after installing the frozen workspace dependencies. It discovers installed transitive parsing packages without adding dependencies or relying on machine-specific paths:

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
async function dependency(name) {
  const entry = readdirSync('node_modules/.pnpm').find(p => p.startsWith(`${name}@`));
  assert.ok(entry, `Missing installed dependency ${name}`);
  return import(pathToFileURL(resolve('node_modules/.pnpm', entry, 'node_modules', name, 'index.js')));
}
const {unified} = await dependency('unified');
const {default: parse} = await dependency('remark-parse');
const {default: gfm} = await dependency('remark-gfm');
const {default: frontmatter} = await dependency('remark-frontmatter');
const parser = unified().use(parse).use(gfm).use(frontmatter);
const clean = tree => JSON.parse(JSON.stringify(tree, (key, val) => key === 'position' ? undefined : val));
function collect(node, type) {
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap(child => collect(child, type))];
}
const files = ['.agents/skills/chip-logo-identification/data/index_table.md', '.claude/skills/chip-logo-identification/data/index_table.md', 'backend/README.md', 'THIRD-PARTY-NOTICES.md'];
for (const file of files) {
  const before = execFileSync('git', ['show', `e5186c3bbddd5b48298f3a8a1987254b9130e6a8:${file}`], {encoding: 'utf8'});
  const after = readFileSync(file, 'utf8');
  const tree = clean(parser.parse(after));
  assert.deepEqual(tree, clean(parser.parse(before)), file);
  if (file.endsWith('index_table.md')) {
    assert.equal((after.match(/\\\[/g) ?? []).length, 12);
    assert.equal(after.replaceAll('\\[', '['), before);
    assert.equal(collect(tree, 'tableRow').length, 490);
    assert.equal(collect(tree, 'link').length, 0);
  } else {
    const expected = file.startsWith('backend/') ? ['mailto:api.contact@digikey.com'] : ['https://github.com/inventree/InvenTree', 'https://github.com/inventree/InvenTree/blob/master/LICENSE'];
    for (const url of expected) {
      const link = collect(tree, 'link').find(node => node.url === url);
      assert.ok(link, url);
      assert.equal(link.children.map(node => node.value).join(''), url.replace(/^mailto:/, ''));
    }
  }
  console.log(`PASS ${file}: semantic AST, literal labels and links preserved`);
}
JS
```

## Limitations and remaining ownership

No product UI changes are expected or introduced. Browser screenshots, frontend build/tests, the full backend suite and scanner/hardware checks were not run because this is a syntax-only documentation/resource repair with complete before/after AST equivalence. Remote URL availability was not checked; destination preservation, not upstream reachability, is the requirement. No provider authentication/inference, inventory API calls, shared-database writes, credential reads or data migration were performed. No tracked test or scratch script was needed.

Changes remain local and uncommitted for the coordinator's independent review. No commit, push, PR, merge or publication was performed. The coordinator owns review and any subsequent publication against the spike consolidation base. Passing local checks does not grant merge permission.

## Independent review clearance

A fresh independent reviewer cleared the exact five-file candidate with no blockers. It independently reproduced all 27 baseline warnings, ran the repaired repository-wide Markdown lint with exit 0, ran workflow-sync with 7 passes, executed the complete GFM AST comparison and verified literal labels, all three link destinations, 490 rows per index, byte-identical full mirrored skill directories and clean whitespace. It did not rerun application/scanner suites, check remote URLs or audit historical setup claims. Source blob IDs were `08a1144eccb6091ef7bb53691de31316a16aaf7c` for both indexes, `a7b9b5e6b32c5a9f0875b88d6df31b35b9734463` for notices and `29aa1f100007f3c210ee9ea4cad4614c2fff8404` for backend README. Only this review record was appended afterward. The reviewed source repairs remain unchanged and local; publication and merging require separate authorization.

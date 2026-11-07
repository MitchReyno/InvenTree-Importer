import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { checkOverlap, loadWorkspace, parseDelta } from '../openspec/overlap.mjs'

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../openspec/overlap.mjs')

function workspace(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'openspec-overlap-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const requirement = (name, body = 'Text SHALL hold.') => `### Requirement: ${name}\n\n${body}\n`
const spec = (...names) => `## Requirements\n\n${names.map((n) => requirement(n)).join('\n')}`
const section = (op, ...blocks) => `## ${op} Requirements\n\n${blocks.join('\n')}`
const renamed = (from, to) =>
  `## RENAMED Requirements\n\n- FROM: \`### Requirement: ${from}\`\n- TO: \`### Requirement: ${to}\`\n`
const check = (root, name, options) => checkOverlap(loadWorkspace(root), name, options)

test('parses delta sections, block text and rename pairs with the CLI parser', () => {
  const parsed = parseDelta(
    `## Purpose\n\n${requirement('Not a delta')}\n${section('ADDED', requirement('New ###', 'Body SHALL be.'))}\n${renamed('A', 'B')}`,
  )
  assert.deepEqual(parsed.ADDED, [
    { name: 'New', raw: '### Requirement: New ###\n\nBody SHALL be.' },
  ])
  assert.deepEqual(parsed.RENAMED, [{ from: 'A', to: 'B' }])
  assert.deepEqual(parsed.problems, [])
})

test('accepts the delta syntax the CLI accepts and ignores fenced examples', () => {
  const fence = '```'
  const parsed = parseDelta(
    `## added requirements\n\n${requirement('A', `Text SHALL hold.\n\n${fence}\n### Requirement: A\n${fence}`)}\n## REMOVED Requirements\n\n- \`### Requirement: Old\`\n\n## RENAMED Requirements\n\n- FROM: \`### Requirement: Lone\`\n`,
  )
  assert.deepEqual(
    parsed.ADDED.map((b) => b.name),
    ['A'],
  )
  assert.deepEqual(parsed.REMOVED, ['Old'])
  assert.deepEqual(parsed.problems, ['unpaired RENAMED FROM "Lone"'])
})

test('name variants are matched as the CLI matches them', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Old Name'),
    'openspec/changes/dupe/specs/shared/spec.md': section(
      'ADDED',
      requirement('A'),
      requirement('A ###'),
    ),
    'openspec/changes/fold/specs/shared/spec.md': `${renamed('Old Name', 'New')}\n${section('REMOVED', requirement('old  name'))}`,
    'openspec/changes/case/specs/shared/spec.md': section('ADDED', requirement('old name')),
    'openspec/changes/header/specs/shared/spec.md': section('ADDED', requirement(' Old Name')),
  })
  assert.ok(
    check(root, 'dupe').errors.some((e) => e.includes('duplicate requirement in ADDED "A"')),
  )
  assert.ok(
    check(root, 'fold').errors.some((e) => e.includes('"Old Name" is both RENAMED and REMOVED')),
  )
  assert.ok(check(root, 'case').errors.some((e) => e.includes('differs only in case or spacing')))
  assert.deepEqual(check(root, 'header').applied, [])
})

test('a modification must keep the current scenarios', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': `## Requirements\n\n${requirement('Rule', 'Text SHALL hold.\n\n#### Scenario: Kept\n\n- **GIVEN** x')}`,
    'openspec/changes/base/specs/shared/spec.md': section(
      'MODIFIED',
      requirement('Rule', 'Text SHALL change.'),
    ),
  })
  assert.ok(check(root, 'base').errors.some((e) => e.includes('drops current scenario(s): kept')))
})

test('a new capability with unique requirements is clean', (t) => {
  const root = workspace(t, {
    'openspec/specs/existing/spec.md': spec('Kept'),
    'openspec/changes/base/specs/fresh/spec.md': section('ADDED', requirement('Fresh rule')),
  })
  assert.deepEqual(check(root, 'base', { newCapabilitiesOnly: true }).errors, [])
})

test('an already-synced addition is applied, not a conflict, even for a new capability', (t) => {
  const root = workspace(t, {
    'openspec/specs/fresh/spec.md': spec('Fresh rule'),
    'openspec/changes/base/specs/fresh/spec.md': section('ADDED', requirement('Fresh rule')),
  })
  const result = check(root, 'base', { newCapabilitiesOnly: true })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.applied, ['fresh: ADDED "Fresh rule"'])
})

test('an addition whose name exists with different text conflicts', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Taken'),
    'openspec/changes/base/specs/shared/spec.md': section(
      'ADDED',
      requirement('Taken', 'Other SHALL differ.'),
    ),
  })
  assert.ok(check(root, 'base').errors.some((e) => e.includes('"Taken" differs')))
})

test('flags names another active change also touches, and warns on the shared capability', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Rule'),
    'openspec/changes/base/specs/shared/spec.md': section('ADDED', requirement('Both')),
    'openspec/changes/later/specs/shared/spec.md': section('ADDED', requirement('Both')),
  })
  const { errors, warnings } = check(root, 'base')
  assert.ok(errors.some((e) => e.includes('"Both" is also changed by later')))
  assert.ok(warnings.some((w) => w.includes('also changed by active change later')))
})

test('new-capabilities-only refuses pending edits to existing or shared capabilities', (t) => {
  const root = workspace(t, {
    'openspec/specs/existing/spec.md': spec('Kept'),
    'openspec/changes/base/specs/existing/spec.md': section('ADDED', requirement('Extra')),
    'openspec/changes/base/specs/claimed/spec.md': section('ADDED', requirement('Mine')),
    'openspec/changes/later/specs/claimed/spec.md': section('ADDED', requirement('Theirs')),
  })
  const { errors } = check(root, 'base', { newCapabilitiesOnly: true })
  assert.ok(errors.some((e) => e.startsWith('existing: exists in openspec/specs')))
  assert.ok(errors.some((e) => e.startsWith('claimed: also changed by active change later')))
})

test('modifications must target existing requirements and are applied once they match', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Rule', 'Done'),
    'openspec/changes/base/specs/shared/spec.md': section(
      'MODIFIED',
      requirement('Rule', 'Changed SHALL apply.'),
      requirement('Done'),
      requirement('Missing'),
    ),
    'openspec/changes/later/specs/shared/spec.md': section(
      'MODIFIED',
      requirement('Rule', 'Theirs SHALL win.'),
    ),
  })
  const { errors, applied } = check(root, 'base')
  assert.ok(errors.some((e) => e.includes('MODIFIED "Missing" is not in the main spec')))
  assert.ok(errors.some((e) => e.includes('"Rule" is also changed by later')))
  assert.deepEqual(applied, ['shared: MODIFIED "Done"'])
})

test('a removal of an absent requirement only warns', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Rule'),
    'openspec/changes/base/specs/shared/spec.md': section('REMOVED', requirement('Gone')),
  })
  const { errors, warnings } = check(root, 'base')
  assert.deepEqual(errors, [])
  assert.ok(warnings.some((w) => w.includes('REMOVED "Gone" is not in the main spec')))
})

test('renames check the source, the destination and concurrent edits', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('A', 'B', 'C', 'Moved'),
    'openspec/changes/base/specs/shared/spec.md': `${renamed('A', 'B')}\n- FROM: \`### Requirement: C\`\n- TO: \`### Requirement: D\`\n- FROM: \`### Requirement: Old\`\n- TO: \`### Requirement: Moved\`\n- FROM: \`### Requirement: Nowhere\`\n- TO: \`### Requirement: Else\`\n`,
    'openspec/changes/later/specs/shared/spec.md': section(
      'MODIFIED',
      requirement('C', 'Edited SHALL differ.'),
    ),
  })
  const { errors, applied } = check(root, 'base')
  assert.ok(errors.some((e) => e.includes('RENAMED destination "B" already exists')))
  assert.ok(errors.some((e) => e.includes('"C" is also changed by later')))
  assert.ok(errors.some((e) => e.includes('RENAMED "Nowhere" is not in the main spec')))
  assert.deepEqual(applied, ['shared: RENAMED "Old" to "Moved"'])
})

test('a synced but unarchived change does not block later edits to its requirements', (t) => {
  const root = workspace(t, {
    'openspec/specs/fresh/spec.md': spec('Rule'),
    'openspec/changes/baseline/specs/fresh/spec.md': section('ADDED', requirement('Rule')),
    'openspec/changes/next/specs/fresh/spec.md': section(
      'MODIFIED',
      requirement('Rule', 'Revised SHALL apply.'),
    ),
  })
  assert.deepEqual(check(root, 'next'), { errors: [], warnings: [], applied: [] })
})

test('a modification may use the new name of a requirement renamed in the same delta', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Old'),
    'openspec/changes/base/specs/shared/spec.md': `${renamed('Old', 'New')}\n${section('MODIFIED', requirement('New', 'Edited SHALL apply.'))}`,
  })
  assert.deepEqual(check(root, 'base').errors, [])
})

test('a synced rename-and-modify counts as applied', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': `## Requirements\n\n${requirement('New', 'Edited SHALL apply.')}`,
    'openspec/changes/base/specs/shared/spec.md': `${renamed('Old', 'New')}\n${section('MODIFIED', requirement('New', 'Edited SHALL apply.'))}`,
  })
  const { errors, applied } = check(root, 'base')
  assert.deepEqual(errors, [])
  assert.deepEqual(applied, ['shared: RENAMED "Old" to "New"', 'shared: MODIFIED "New"'])
})

test('a Markdown structure change is pending, not applied; only line endings are normalized', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': `## Requirements\r\n\r\n${requirement('Rule', '- one\r\n- two')}`,
    'openspec/changes/base/specs/shared/spec.md': section(
      'MODIFIED',
      requirement('Rule', '- one - two'),
    ),
    'openspec/changes/same/specs/shared/spec.md': section(
      'MODIFIED',
      requirement('Rule', '- one\n- two'),
    ),
  })
  assert.deepEqual(check(root, 'base', { newCapabilitiesOnly: true }).applied, [])
  assert.ok(check(root, 'base', { newCapabilitiesOnly: true }).errors.length > 0)
  assert.deepEqual(check(root, 'same').applied, ['shared: MODIFIED "Rule"'])
})

test('duplicates and contradictory sections are rejected, as OpenSpec rejects them', (t) => {
  const cases = {
    'duplicate requirement in MODIFIED "A"': `${section('MODIFIED', requirement('A', 'New SHALL be.'))}\n${section('MODIFIED', requirement('A'))}`,
    '"A" is both ADDED and REMOVED': `${section('ADDED', requirement('A'))}\n${section('REMOVED', requirement('A'))}`,
    '"A" is both MODIFIED and REMOVED': `${section('MODIFIED', requirement('A'))}\n${section('REMOVED', requirement('A'))}`,
    '"A" is both MODIFIED and ADDED': `${section('MODIFIED', requirement('A'))}\n${section('ADDED', requirement('A'))}`,
    'RENAMED destination "B" collides with ADDED': `${renamed('A', 'B')}\n${section('ADDED', requirement('B'))}`,
    '"A" is both RENAMED and REMOVED': `${renamed('A', 'B')}\n${section('REMOVED', requirement('A'))}`,
    'MODIFIED must use the new name "B"': `${renamed('A', 'B')}\n${section('MODIFIED', requirement('A'))}`,
    'duplicate requirement in RENAMED FROM "A"': `${renamed('A', 'B')}\n- FROM: \`### Requirement: A\`\n- TO: \`### Requirement: C\`\n`,
  }
  for (const [expected, delta] of Object.entries(cases)) {
    const root = workspace(t, {
      'openspec/specs/shared/spec.md': spec('A'),
      'openspec/changes/base/specs/shared/spec.md': delta,
    })
    const { errors } = check(root, 'base')
    assert.ok(
      errors.some((e) => e.includes(expected)),
      `${expected}: ${errors.join('; ')}`,
    )
  }
})

test('a change with problems still blocks another change on the names it mentions', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('A'),
    'openspec/changes/broken/specs/shared/spec.md': `${section('ADDED', requirement('A'))}\n${section('REMOVED', requirement('A'))}`,
    'openspec/changes/base/specs/shared/spec.md': section(
      'MODIFIED',
      requirement('A', 'Mine SHALL be.'),
    ),
  })
  assert.ok(check(root, 'base').errors.some((e) => e.includes('"A" is also changed by broken')))
})

test('archived changes are not treated as pending', (t) => {
  const root = workspace(t, {
    'openspec/changes/base/specs/fresh/spec.md': section('ADDED', requirement('Rule')),
    'openspec/changes/archive/2026-01-01-old/specs/fresh/spec.md': section(
      'ADDED',
      requirement('Rule'),
    ),
  })
  assert.deepEqual(check(root, 'base', { newCapabilitiesOnly: true }).errors, [])
})

test('the CLI exits non-zero on conflicts and for an unknown change', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Taken'),
    'openspec/changes/base/specs/shared/spec.md': section(
      'ADDED',
      requirement('Taken', 'Different SHALL be.'),
    ),
  })
  const run = (...args) =>
    spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' })
  assert.equal(run('--change', 'base').status, 1)
  assert.equal(run('--change', 'missing').status, 1)
  assert.equal(run().status, 2)
})

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

const spec = (...names) =>
  names.map((name) => `### Requirement: ${name}\n\nText SHALL hold.\n`).join('\n')
const delta = (op, ...names) => `## ${op} Requirements\n\n${spec(...names)}`

test('parses each delta section and ignores headings outside it', () => {
  const parsed = parseDelta(
    `## Purpose\n\n### Requirement: Not a delta\n\n${delta('ADDED', 'New')}\n${delta('MODIFIED', 'Old')}\n## RENAMED Requirements\n\n- FROM: \`### Requirement: A\`\n- TO: \`### Requirement: B\`\n`,
  )
  assert.deepEqual(parsed.ADDED, ['New'])
  assert.deepEqual(parsed.MODIFIED, ['Old'])
  assert.deepEqual(parsed.RENAMED, ['FROM:A', 'TO:B'])
})

test('a new capability with unique requirements is clean', (t) => {
  const root = workspace(t, {
    'openspec/specs/existing/spec.md': spec('Kept'),
    'openspec/changes/base/specs/fresh/spec.md': delta('ADDED', 'Fresh rule'),
  })
  assert.deepEqual(checkOverlap(loadWorkspace(root), 'base', { newCapabilitiesOnly: true }), {
    errors: [],
    warnings: [],
  })
})

test('flags additions that collide with the main spec or another change', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Taken'),
    'openspec/changes/base/specs/shared/spec.md': delta('ADDED', 'Taken', 'Both'),
    'openspec/changes/later/specs/shared/spec.md': delta('ADDED', 'Both'),
  })
  const { errors, warnings } = checkOverlap(loadWorkspace(root), 'base')
  assert.ok(errors.some((e) => e.includes('"Taken" already exists')))
  assert.ok(errors.some((e) => e.includes('"Both" is also ADDED by later')))
  assert.ok(warnings.some((w) => w.includes('also changed by active change later')))
})

test('new-capabilities-only refuses existing or shared capabilities', (t) => {
  const root = workspace(t, {
    'openspec/specs/existing/spec.md': spec('Kept'),
    'openspec/changes/base/specs/existing/spec.md': delta('ADDED', 'Extra'),
    'openspec/changes/base/specs/claimed/spec.md': delta('ADDED', 'Mine'),
    'openspec/changes/later/specs/claimed/spec.md': delta('ADDED', 'Theirs'),
  })
  const { errors } = checkOverlap(loadWorkspace(root), 'base', { newCapabilitiesOnly: true })
  assert.ok(errors.some((e) => e.startsWith('existing: exists in openspec/specs')))
  assert.ok(errors.some((e) => e.startsWith('claimed: also changed by active change later')))
})

test('flags modifications of missing or concurrently modified requirements', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Rule'),
    'openspec/changes/base/specs/shared/spec.md': `${delta('MODIFIED', 'Rule')}\n${delta('REMOVED', 'Gone')}`,
    'openspec/changes/later/specs/shared/spec.md': delta('MODIFIED', 'Rule'),
  })
  const { errors } = checkOverlap(loadWorkspace(root), 'base')
  assert.ok(errors.some((e) => e.includes('REMOVED "Gone" is not in the main spec')))
  assert.ok(errors.some((e) => e.includes('"Rule" is also modified or removed by later')))
})

test('archived changes are not treated as pending', (t) => {
  const root = workspace(t, {
    'openspec/changes/base/specs/fresh/spec.md': delta('ADDED', 'Rule'),
    'openspec/changes/archive/2026-01-01-old/specs/fresh/spec.md': delta('ADDED', 'Rule'),
  })
  assert.deepEqual(
    checkOverlap(loadWorkspace(root), 'base', { newCapabilitiesOnly: true }).errors,
    [],
  )
})

test('the CLI exits non-zero on conflicts and for an unknown change', (t) => {
  const root = workspace(t, {
    'openspec/specs/shared/spec.md': spec('Taken'),
    'openspec/changes/base/specs/shared/spec.md': delta('ADDED', 'Taken'),
  })
  const run = (...args) =>
    spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' })
  assert.equal(run('--change', 'base').status, 1)
  assert.equal(run('--change', 'missing').status, 1)
  assert.equal(run().status, 2)
})

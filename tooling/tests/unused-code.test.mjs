import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  compareBaseline,
  findingsFromKnip,
  invalidPlannedTags,
  withoutPlannedFiles,
} from '../unused-code/check.mjs'

function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'unused-code-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test('reads unused files, exports, types and dependencies from the knip report', () => {
  const report = {
    issues: [
      {
        file: 'frontend/src/a.ts',
        files: [{ name: 'frontend/src/a.ts' }],
        exports: [{ name: 'unusedThing', line: 3 }],
        types: [{ name: 'UnusedType', line: 9 }],
        dependencies: [],
      },
      { file: 'package.json', devDependencies: [{ name: 'left-pad', line: 4 }] },
    ],
  }

  assert.deepEqual(findingsFromKnip(report), [
    { file: 'frontend/src/a.ts', kind: 'file', name: '', line: 1 },
    { file: 'frontend/src/a.ts', kind: 'export', name: 'unusedThing', line: 3 },
    { file: 'frontend/src/a.ts', kind: 'type', name: 'UnusedType', line: 9 },
    { file: 'package.json', kind: 'devDependency', name: 'left-pad', line: 4 },
  ])
})

test('requires every @planned tag to name the planned task or item it is kept for', (t) => {
  const root = tree(t, {
    'frontend/src/kept.ts': '/** @planned BI-005 purchase orders */\nexport const po = 1\n',
    'frontend/src/task.ts': '/** @planned task 23.6 pause all */\nexport const pause = 1\n',
    'frontend/src/vague.ts': '/** @planned later */\nexport const maybe = 1\n',
    'intake-server/src/bare.ts': '// @planned\nexport const bare = 1\n',
  })

  assert.deepEqual(invalidPlannedTags(root, ['frontend/src', 'intake-server/src']), [
    { file: 'frontend/src/vague.ts', line: 1 },
    { file: 'intake-server/src/bare.ts', line: 1 },
  ])
})

test('keeps a whole file reserved for planned work out of the unused files', (t) => {
  const root = tree(t, {
    'frontend/src/planned.ts': '// @planned BI-004 automatic logos\nexport const logos = 1\n',
    'frontend/src/dead.ts': 'export const dead = 1\n',
  })
  const findings = [
    { file: 'frontend/src/planned.ts', kind: 'file', name: '', line: 1 },
    { file: 'frontend/src/dead.ts', kind: 'file', name: '', line: 1 },
  ]

  assert.deepEqual(
    withoutPlannedFiles(root, findings).map((finding) => finding.file),
    ['frontend/src/dead.ts'],
  )
})

test('lets the baseline only shrink', () => {
  const finding = (file, kind, name) => ({ file, kind, name, line: 1 })
  const baseline = ['a.ts | export | one', 'b.ts | file | ']

  assert.deepEqual(compareBaseline(baseline, [finding('a.ts', 'export', 'one')]), {
    grown: [],
    shrunk: ['b.ts | file | '],
  })
  assert.deepEqual(
    compareBaseline(baseline, [
      finding('a.ts', 'export', 'one'),
      finding('b.ts', 'file', ''),
      finding('c.ts', 'type', 'New'),
    ]),
    { grown: ['c.ts | type | New'], shrunk: [] },
  )
})

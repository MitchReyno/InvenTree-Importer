import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validationIssues, validate } from '../src/index.ts'

const source = {
  kind: 'note',
  note_id: '10000000-0000-4000-8000-000000000001',
  text_sha256: 'a'.repeat(64),
}
const value = {
  proposal: {
    schema_version: 'bench-intake-proposal/5',
    subject_id: source.note_id,
    summary: 'Label quantity',
    sources: [source],
    quantity: { status: 'estimated' },
    relies_on: { fields: ['quantity'], sources: [source] },
  },
}

test('contract diagnostics name a missing nested field and preserve validate semantics', () => {
  const issues = validationIssues('SessionProposeArgs', value)
  assert.ok(
    issues.some((issue) => issue.path === '/proposal/quantity/value' && issue.rule === 'required'),
  )
  assert.throws(() => validate('SessionProposeArgs', value), /^Error: invalid_contract$/)
  const fixed = { proposal: { ...value.proposal, quantity: { value: '20', status: 'estimated' } } }
  assert.deepEqual(validationIssues('SessionProposeArgs', fixed), [])
  assert.ok(
    issues.some((issue) => issue.path === '/proposal/quantity/value'),
    'a subsequent validation cannot mutate copied issues',
  )
})

test('diagnostics never echo values or unknown property names and stay bounded', () => {
  const secret = 'sk-secret-do-not-echo'
  const input = {
    proposal: { ...value.proposal, summary: secret, quantity: { [secret]: 'private' } },
  }
  const issues = validationIssues('SessionProposeArgs', input)
  assert.ok(issues.length > 0 && issues.length <= 8)
  assert.ok(Buffer.byteLength(JSON.stringify(issues)) <= 2048)
  assert.equal(JSON.stringify(issues).includes(secret), false)
})

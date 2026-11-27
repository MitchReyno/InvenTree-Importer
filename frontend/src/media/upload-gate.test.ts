import { expect, test } from 'vitest'
import { uploadRefusal, type UploadGateState } from './upload-gate'

const open: UploadGateState = {
  archived: false,
  disabled: false,
  current: true,
  sending: false,
  unconfirmed: false,
  otherDraftOpen: false,
}

test('an open gate refuses nothing', () => {
  expect(uploadRefusal(open)).toBeNull()
})

test.each([
  ['archived', { archived: true, disabled: true }, /Resume the batch/],
  ['disabled', { disabled: true }, /other Capture changes/],
  ['stale', { current: false }, /fresh read/],
  ['pending', { sending: true }, /being sent/],
  ['pending', { unconfirmed: true }, /retried or discarded/],
  ['draft', { otherDraftOpen: true }, /other evidence changes/],
] as const)('refuses as %s with its reason', (kind, change, reason) => {
  const refusal = uploadRefusal({ ...open, ...change })
  expect(refusal?.kind).toBe(kind)
  expect(refusal?.reason).toMatch(reason)
})

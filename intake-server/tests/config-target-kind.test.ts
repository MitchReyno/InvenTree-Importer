import { test } from 'node:test'
import assert from 'node:assert/strict'
import { devConfig } from '../src/config.ts'

test('the fake development profile is the owned test target; others are configured targets', () => {
  assert.equal(devConfig({ INTAKE_TARGET_PROFILE: 'fake' }).targetKind, 'owned_test')
  assert.equal(devConfig({ INTAKE_TARGET_PROFILE: 'read-only' }).targetKind, 'configured')
  assert.equal(devConfig({}).targetKind, 'configured')
})

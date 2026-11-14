const test = require('node:test')
const assert = require('node:assert/strict')
const { processingWorker } = require('../dev/profile.cjs')

test('session profiles, scripted or real, start the session worker', () => {
  for (const profile of [
    'synthetic-session/1',
    'native-agent/2',
    'shared-vm-agent/1',
    'shared-vm-agent/2',
  ]) {
    assert.deepEqual(processingWorker(profile), {
      entry: 'src/agents/session/session-worker-main.ts',
      ready: 'session supervisor ready',
    })
  }
})

test('native-agent/1 keeps the single-result worker', () => {
  assert.equal(processingWorker('native-agent/1').entry, 'src/agents/worker-main.ts')
})

test('the scripted per-stage pipeline runs in the synthetic processing child', () => {
  assert.equal(processingWorker('synthetic-research/2'), null)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { developmentProfile, processingWorker } = require('../dev/profile.cjs')

test('the dev server accepts the session profile and starts its worker', () => {
  assert.equal(
    developmentProfile({ INTAKE_PROCESSING_PROFILE: 'native-agent/2' }),
    'native-agent/2',
  )
  assert.deepEqual(processingWorker('native-agent/2'), {
    entry: 'src/agents/session-worker-main.ts',
    ready: 'session supervisor ready',
  })
})

test('native-agent/1 keeps the single-result worker and the default stays synthetic', () => {
  assert.equal(developmentProfile({}), 'synthetic-research/2')
  assert.equal(processingWorker('synthetic-research/2'), null)
  assert.equal(processingWorker('native-agent/1').entry, 'src/agents/worker-main.ts')
})

test('any other profile is still refused', () => {
  assert.throws(
    () => developmentProfile({ INTAKE_PROCESSING_PROFILE: 'synthetic-session/1' }),
    /unsupported_development_profile/,
  )
})

test('the shared VM profile selects the session coordinator', () => {
  const profile = developmentProfile({ INTAKE_PROCESSING_PROFILE: 'shared-vm-agent/1' })
  assert.equal(processingWorker(profile).entry, 'src/agents/session-worker-main.ts')
})

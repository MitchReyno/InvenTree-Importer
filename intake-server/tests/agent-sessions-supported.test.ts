import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionsSupported } from '../src/agents/session/sessions.ts'
import { mediaProfileId } from '../src/processing/model.ts'
import { isSessionProfile } from '../src/processing/session-policy.ts'

test('the session list says whether the configured profile runs agent sessions', () => {
  assert.equal(sessionsSupported({ profileId: mediaProfileId } as never), false)
  assert.equal(sessionsSupported({} as never), isSessionProfile(mediaProfileId))
  assert.equal(sessionsSupported({ profileId: 'synthetic-session/1' } as never), true)
  assert.equal(sessionsSupported({ profileId: 'native-agent/2' } as never), true)
  assert.equal(sessionsSupported({ profileId: 'shared-vm-agent/1' } as never), true)
})

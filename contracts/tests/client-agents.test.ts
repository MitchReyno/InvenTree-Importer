import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentsClient, IntakeRequestError } from '../generated/client.ts'
import { validate } from '../src/index.ts'
import type { AgentSettingsDto, AgentSettingsUpdateDto } from '../src/agents.ts'

const saveId = '10000000-0000-4000-8000-000000000001'
const fields: Omit<AgentSettingsDto, 'revision'> = {
  providers: {
    claude: { enabled: true, authentication: 'subscription', default_model: 'sonnet' },
    codex: { enabled: false, authentication: 'subscription', default_model: 'gpt-6.1-sol' },
  },
  default_provider: 'claude',
  stage_selections: {},
  stage_instructions: {},
  session_concurrency: 3,
  new_batch_instructions: '',
  part_description_style: '',
  auto_tags_default: false,
  web: { public_pages: true, prefer_datasheets: true },
}
const update: AgentSettingsUpdateDto = { ...fields, expected_revision: '4', save_id: saveId }

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function clientAnswering(response: () => Response) {
  const sent: unknown[] = []
  const transport: typeof fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)))
    return response()
  }
  return { sent, client: agentsClient('http://127.0.0.1:1', 'a'.repeat(64), transport) }
}

test('a settings update carries its save ID, and one without it is refused before sending', async () => {
  const { save_id: _saveId, ...withoutId } = update
  assert.throws(() => validate('AgentSettingsUpdate', withoutId), { message: 'invalid_contract' })
  assert.throws(() => validate('AgentSettingsUpdate', { ...update, save_id: 'not-a-uuid' }), {
    message: 'invalid_contract',
  })
  const { sent, client } = clientAnswering(() => json({ ...fields, revision: '5' }))
  assert.deepEqual(await client.saveSettings(update), { ...fields, revision: '5' })
  assert.deepEqual(sent, [update])
})

test('a save answers with the saved settings or, for a resend that already applied, its receipt', async () => {
  const replay = { save_id: saveId, revision: '5', replayed: true }
  const { client } = clientAnswering(() => json(replay))
  assert.deepEqual(await client.saveSettings(update), replay)
  // A receipt is never mistaken for settings, nor settings for a receipt.
  assert.throws(() => validate('AgentSettingsSaveResult', { ...replay, revision: '0' }), {
    message: 'invalid_contract',
  })
  assert.throws(
    () => validate('AgentSettingsSaveResult', { ...fields, revision: '5', replayed: true }),
    { message: 'invalid_contract' },
  )
})

test('a save the server cannot confirm is a typed error, apart from a conflict', async () => {
  for (const [code, status] of [
    ['save_outcome_unknown', 409],
    ['revision_conflict', 412],
  ] as const) {
    const { client } = clientAnswering(() =>
      json(
        {
          code,
          message: 'Agent request could not be accepted.',
          recovery: 'refresh',
          correlation_id: 'c',
        },
        status,
      ),
    )
    await assert.rejects(client.saveSettings(update), (error: unknown) => {
      assert.ok(error instanceof IntakeRequestError)
      assert.equal(error.code, code)
      assert.equal(error.status, status)
      return true
    })
  }
})

const selection = { provider: 'claude', authentication: 'subscription', model: 'claude-opus-5-5' }

test('a selection seals an effort or none, and an effort of the wrong shape is refused', () => {
  validate('AgentSelection', selection)
  validate('AgentSelection', { ...selection, effort: 'high' })
  validate('AgentSelection', { ...selection, effort: 'x_high-2' })
  validate('AgentSelection', { ...selection, effort: 'a'.repeat(32) })
  for (const effort of ['', 'High', '2high', 'very high', 'a'.repeat(33), 'high\n', null, 3]) {
    assert.throws(
      () => validate('AgentSelection', { ...selection, effort }),
      { message: 'invalid_contract' },
      JSON.stringify(effort),
    )
  }
})

test('settings with step and provider efforts round-trip, and a bad effort is refused before sending', async () => {
  const withEfforts: AgentSettingsUpdateDto = {
    ...update,
    providers: {
      claude: { ...fields.providers.claude, default_effort: 'high' },
      codex: { ...fields.providers.codex, default_effort: 'low' },
    },
    stage_selections: {
      research: { provider: 'claude', model: 'claude-opus-5-5', effort: 'max' },
      images: { provider: 'claude', model: 'claude-sonnet-5' },
    },
  }
  const { expected_revision: _revision, save_id: _saveId, ...saved } = withEfforts
  const { sent, client } = clientAnswering(() => json({ ...saved, revision: '5' }))
  assert.deepEqual(await client.saveSettings(withEfforts), { ...saved, revision: '5' })
  assert.deepEqual(sent, [withEfforts])
  const badStep = {
    ...withEfforts,
    stage_selections: { research: { provider: 'claude', model: 'claude-opus-5-5', effort: 'Max' } },
  }
  const badProvider = {
    ...withEfforts,
    providers: {
      ...withEfforts.providers,
      codex: { ...fields.providers.codex, default_effort: '' },
    },
  }
  for (const body of [badStep, badProvider]) {
    const refused = clientAnswering(() => json({ ...saved, revision: '5' }))
    await assert.rejects(refused.client.saveSettings(body as AgentSettingsUpdateDto), {
      message: 'invalid_contract',
    })
    assert.deepEqual(refused.sent, [])
  }
})

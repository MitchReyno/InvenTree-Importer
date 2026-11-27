import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'

const id = (n: number) => `7c3e1d04-92ab-4f6e-b81d-${n.toString(16).padStart(12, '0')}`
const digest = (c: string) => c.repeat(64)

const fields = {
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
const update = { ...fields, expected_revision: '4', save_id: id(9) }

// Four UTF-16 units each: two astral characters.
const ASTRAL = '\u{1F50C}'

test('settings carry each agent step’s instructions; Inventory and empty text are refused', () => {
  validate('AgentSettings', { ...fields, revision: '4' })
  validate('AgentSettingsUpdate', {
    ...update,
    stage_instructions: { research: 'Open the datasheet first.', images: 'Keep the bag.' },
  })
  // 1,000 astral characters fit the contract; the server counts the limit in characters.
  validate('AgentSettingsUpdate', {
    ...update,
    stage_instructions: { examine: ASTRAL.repeat(1000) },
  })
  const { stage_instructions: _missing, ...withoutInstructions } = update
  for (const body of [
    withoutInstructions,
    { ...update, stage_instructions: { inventory: 'Count the reels.' } },
    { ...update, stage_instructions: { research: '' } },
    { ...update, stage_instructions: { research: null } },
    { ...update, stage_instructions: { research: 'x'.repeat(2001) } },
  ]) {
    assert.throws(() => validate('AgentSettingsUpdate', body), { message: 'invalid_contract' })
  }
})

const lotInput = {
  schema_version: 'bench-intake-input/6',
  batch_id: id(50),
  source_id: id(51),
  capture_revision: '12',
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
  notes: [],
  observations: [],
  profile_id: 'native-agent/2',
  instruction_version: 'native-agent/2',
  instruction_sha256: digest('d'),
  tool_profile_version: 'native-session-tools/1',
  media: { manifest: '{}', sha256: digest('e') },
  agent: { provider: 'claude', authentication: 'subscription', model: 'claude-opus-5-5' },
  settings_revision: '3',
  pinned_proposal_ids: [],
  stage: 'examine',
  subject_id: null,
  subject: null,
  linked_part: null,
}

test('a /6 input seals its step’s instructions or none, at most 1,000 characters', () => {
  // A retained input from before step instructions has no field.
  validate('ProcessingInputV6', lotInput)
  validate('ProcessingInputV6', { ...lotInput, stage_instructions: 'Group reels by label.' })
  validate('ProcessingInputV6', { ...lotInput, stage_instructions: ASTRAL.repeat(1000) })
  for (const text of ['', 'x'.repeat(1001), ASTRAL.repeat(1001), 3]) {
    assert.throws(
      () => validate('ProcessingInputV6', { ...lotInput, stage_instructions: text }),
      { message: 'invalid_contract' },
      String(text).slice(0, 12),
    )
  }
})

const sections = [
  { name: 'batch', count: 0 },
  { name: 'human', count: 1 },
  { name: 'asked', count: 0 },
  { name: 'evidence', count: 0 },
  { name: 'match', count: 0 },
  { name: 'identity', count: 0 },
  { name: 'observations', count: 0 },
  { name: 'vocabulary', count: 0 },
]
const guidance = {
  kind: 'step_guidance',
  source: 'human',
  stage: 'research',
  text: 'Open the manufacturer’s own datasheet first.',
}
const brief = (entries: unknown[]) => ({
  schema_version: 'bench-intake-brief/1',
  stage: 'research',
  lot_id: id(4),
  revision: '12',
  sections,
  entries,
})

test('a brief’s step guidance is the operator’s, for a step, within the limit', () => {
  validate('SessionBrief', brief([guidance]))
  validate('SessionBrief', brief([{ ...guidance, text: ASTRAL.repeat(1000) }]))
  for (const entry of [
    { ...guidance, source: 'agent' },
    { ...guidance, stage: 'inventory' },
    { ...guidance, text: '' },
    { ...guidance, text: 'x'.repeat(1001) },
    { ...guidance, extra: true },
  ]) {
    assert.throws(() => validate('SessionBrief', brief([entry])), { message: 'invalid_contract' })
  }
})

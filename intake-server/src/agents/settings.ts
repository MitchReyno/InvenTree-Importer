import type { Pool, PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import {
  AGENT_MODEL_SUGGESTIONS,
  AGENT_SETTINGS_STAGES,
  validate,
  type AgentProviderId,
  type AgentProviderSettingsDto,
  type AgentSelectionDto,
  type AgentSettingsDto,
  type AgentSettingsUpdateDto,
} from '@invimport/contracts'
import type { CaptureBinding } from '#/capture/model.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { fail } from '#/processing/model.ts'
import { agentProviderSettings, agentSettings } from './schema.ts'

export const DEFAULT_SESSION_CONCURRENCY = 3

const PROVIDERS = ['claude', 'codex'] as const satisfies readonly AgentProviderId[]
// The model ID pattern of `AgentSelection`; free text otherwise.
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

function settingsScope(binding: CaptureBinding) {
  return and(
    eq(agentSettings.actorId, binding.actorId),
    eq(agentSettings.targetId, binding.targetId),
    eq(agentSettings.targetContextId, binding.targetContextId),
  )
}

function providerScope(binding: CaptureBinding) {
  return and(
    eq(agentProviderSettings.actorId, binding.actorId),
    eq(agentProviderSettings.targetId, binding.targetId),
    eq(agentProviderSettings.targetContextId, binding.targetContextId),
  )
}

function providerOff(provider: AgentProviderId): AgentProviderSettingsDto {
  return {
    enabled: false,
    authentication: 'subscription',
    default_model: AGENT_MODEL_SUGGESTIONS[provider][0],
  }
}

/** What an actor with no saved settings reads: both providers off and every step on Default. */
export function unsavedAgentSettings(): AgentSettingsDto {
  return {
    revision: '0',
    providers: { claude: providerOff('claude'), codex: providerOff('codex') },
    default_provider: null,
    stage_selections: {},
    session_concurrency: DEFAULT_SESSION_CONCURRENCY,
    new_batch_instructions: '',
    part_description_style: '',
    auto_tags_default: false,
  }
}

export async function readAgentSettings(
  client: Pool | PoolClient,
  binding: CaptureBinding,
  lock = false,
): Promise<AgentSettingsDto> {
  const db = queryDatabase(client)
  const query = db.select().from(agentSettings).where(settingsScope(binding))
  const rows = await executeDatabaseQuery(lock ? query.for('share') : query)
  const row = rows[0]
  if (!row) {
    return unsavedAgentSettings()
  }
  // Provider rows change only with their parent row, which the share lock above holds.
  const providerRows = await executeDatabaseQuery(
    db.select().from(agentProviderSettings).where(providerScope(binding)),
  )
  const providers = { claude: providerOff('claude'), codex: providerOff('codex') }
  for (const provider of providerRows) {
    providers[provider.provider] = {
      enabled: provider.enabled,
      authentication: provider.authentication,
      default_model: provider.defaultModel,
    }
  }
  return {
    revision: row.revision.toString(),
    providers,
    default_provider: row.defaultProvider,
    stage_selections: row.stageSelections,
    session_concurrency: row.sessionConcurrency,
    new_batch_instructions: row.newBatchInstructions,
    part_description_style: row.partDescriptionStyle,
    auto_tags_default: row.autoTagsDefault,
  }
}

/** Refuses settings that could seal an attempt on a provider that is off or an invalid model. */
function checkAgentSettings(input: AgentSettingsUpdateDto) {
  const on = PROVIDERS.filter((provider) => input.providers[provider].enabled)
  const defaultOn = input.default_provider !== null && input.providers[input.default_provider].enabled
  const invalid =
    on.some((provider) => !MODEL_ID.test(input.providers[provider].default_model)) ||
    (on.length > 0 ? !defaultOn : input.default_provider !== null) ||
    AGENT_SETTINGS_STAGES.some((stage) => {
      const choice = input.stage_selections[stage]
      return choice && (!input.providers[choice.provider].enabled || !MODEL_ID.test(choice.model))
    })
  if (invalid) {
    fail('invalid_agent_settings', 422)
  }
}

/**
 * The rollback columns from before independent providers: the default provider while one is
 * on, otherwise left as they are, or a valid fallback on a first save.
 */
function legacySelection(input: AgentSettingsUpdateDto): AgentSelectionDto | undefined {
  if (!input.default_provider) {
    return undefined
  }
  const provider = input.providers[input.default_provider]
  return {
    provider: input.default_provider,
    authentication: provider.authentication,
    model: provider.default_model,
  }
}

const FIRST_SAVE_FALLBACK: AgentSelectionDto = {
  provider: 'claude',
  authentication: 'subscription',
  model: AGENT_MODEL_SUGGESTIONS.claude[0],
}

export async function saveAgentSettings(
  pool: Pool,
  binding: CaptureBinding,
  input: AgentSettingsUpdateDto,
) {
  validate('AgentSettingsUpdate', input)
  checkAgentSettings(input)
  const legacy = legacySelection(input)
  const fields = {
    defaultProvider: input.default_provider,
    stageSelections: input.stage_selections,
    sessionConcurrency: input.session_concurrency,
    newBatchInstructions: input.new_batch_instructions,
    partDescriptionStyle: input.part_description_style,
    autoTagsDefault: input.auto_tags_default,
  }
  return transaction(pool, async (client) => {
    const db = queryDatabase(client)
    if (input.expected_revision === '0') {
      const inserted = await executeDatabaseQuery(
        db
          .insert(agentSettings)
          .values({
            actorId: binding.actorId,
            targetId: binding.targetId,
            targetContextId: binding.targetContextId,
            ...(legacy ?? FIRST_SAVE_FALLBACK),
            ...fields,
            revision: 1n,
          })
          .onConflictDoNothing()
          .returning(),
      )
      if (!inserted.length) {
        fail('revision_conflict', 412)
      }
    } else {
      const updated = await executeDatabaseQuery(
        db
          .update(agentSettings)
          .set({ ...legacy, ...fields, revision: BigInt(input.expected_revision) + 1n })
          .where(
            and(
              settingsScope(binding),
              eq(agentSettings.revision, BigInt(input.expected_revision)),
            ),
          )
          .returning(),
      )
      if (!updated.length) {
        fail('revision_conflict', 412)
      }
    }
    for (const provider of PROVIDERS) {
      const values = {
        enabled: input.providers[provider].enabled,
        authentication: input.providers[provider].authentication,
        defaultModel: input.providers[provider].default_model,
      }
      await executeDatabaseQuery(
        db
          .insert(agentProviderSettings)
          .values({
            actorId: binding.actorId,
            targetId: binding.targetId,
            targetContextId: binding.targetContextId,
            provider,
            ...values,
          })
          .onConflictDoUpdate({
            target: [
              agentProviderSettings.actorId,
              agentProviderSettings.targetId,
              agentProviderSettings.targetContextId,
              agentProviderSettings.provider,
            ],
            set: values,
          }),
      )
    }
    return readAgentSettings(client, binding)
  })
}

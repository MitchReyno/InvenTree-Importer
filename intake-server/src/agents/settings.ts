import type { Pool, PoolClient } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
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

type ProviderRow = {
  provider: AgentProviderId
  enabled: boolean
  authentication: AgentProviderSettingsDto['authentication']
  default_model: string
}

export async function readAgentSettings(
  client: Pool | PoolClient,
  binding: CaptureBinding,
  lock = false,
): Promise<AgentSettingsDto> {
  const db = queryDatabase(client)
  if (lock) {
    // Its own statement, so the read below starts after any save holding the row has committed.
    await executeDatabaseQuery(
      db
        .select({ revision: agentSettings.revision })
        .from(agentSettings)
        .where(settingsScope(binding))
        .for('share'),
    )
  }
  // One statement, so the provider rows always come from the same save as their parent row.
  // Outer columns are written out in full: Drizzle drops their table name inside a subquery.
  const rows = await executeDatabaseQuery(
    db
      .select({
        row: agentSettings,
        providers: sql<ProviderRow[]>`(
          SELECT coalesce(json_agg(json_build_object(
            'provider', p.provider, 'enabled', p.enabled,
            'authentication', p.authentication, 'default_model', p.default_model)), '[]'::json)
          FROM agent_provider_settings p
          WHERE p.actor_id = agent_settings.actor_id
            AND p.target_id = agent_settings.target_id
            AND p.target_context_id = agent_settings.target_context_id)`,
      })
      .from(agentSettings)
      .where(settingsScope(binding)),
  )
  if (!rows[0]) {
    return unsavedAgentSettings()
  }
  const { row, providers: providerRows } = rows[0]
  const providers = { claude: providerOff('claude'), codex: providerOff('codex') }
  for (const { provider, ...settings } of providerRows) {
    providers[provider] = settings
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
  const defaultOn =
    input.default_provider !== null && input.providers[input.default_provider].enabled
  const invalid =
    // Even a provider that is off keeps a model the column can store.
    PROVIDERS.some((provider) => input.providers[provider].default_model.length > 128) ||
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

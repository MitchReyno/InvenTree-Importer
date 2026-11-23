import { createHash } from 'node:crypto'
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
  type AgentSettingsSaveReplayDto,
  type AgentSettingsUpdateDto,
} from '@invimport/contracts'
import { canonicalRecord } from '@invimport/contracts/json'
import type { CaptureBinding } from '#/capture/model.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { fail } from '#/processing/model.ts'
import { storableText } from '#/db/storable-text.ts'
import { agentProviderSettings, agentSettings, agentSettingsSaveReceipts } from './schema.ts'

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
    web: { public_pages: true, prefer_datasheets: true },
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
    web: { public_pages: row.webPublicPages, prefer_datasheets: row.webPreferDatasheets },
  }
}

function storedText(input: AgentSettingsUpdateDto) {
  return [
    input.new_batch_instructions,
    input.part_description_style,
    ...PROVIDERS.map((provider) => input.providers[provider].default_model),
  ]
}

/** Refuses settings that could seal an attempt on a provider that is off or an invalid model. */
function checkAgentSettings(input: AgentSettingsUpdateDto) {
  const on = PROVIDERS.filter((provider) => input.providers[provider].enabled)
  const defaultOn =
    input.default_provider !== null && input.providers[input.default_provider].enabled
  const invalid =
    // Even a provider that is off keeps a model the column can store. Text with a NUL can't be
    // stored, and an unpaired surrogate would be changed on the way in.
    PROVIDERS.some((provider) => input.providers[provider].default_model.length > 128) ||
    storedText(input).some((text) => !storableText(text)) ||
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

/** Save receipts kept per settings scope: the newest this many, for at most a week. */
const RECEIPTS_KEPT = 200
const RECEIPT_MAX_AGE = '7 days'

/** What a resend must repeat exactly: every submitted field, without its revision or save ID. */
function submittedDigest(input: AgentSettingsUpdateDto) {
  const { expected_revision: _revision, save_id: _saveId, ...fields } = input
  return createHash('sha256').update(canonicalRecord(fields)).digest()
}

/** Serialises every save of one settings scope, including first saves, which have no row to lock. */
async function lockSettingsScope(client: PoolClient, binding: CaptureBinding) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `agent-settings-save/1:${binding.actorId}:${binding.targetId}:${binding.targetContextId}`,
  ])
}

/**
 * The receipt of an earlier send of this save, if it applied. A save ID reused for another
 * scope, other fields or another base revision is refused rather than answered.
 */
async function priorReceipt(
  client: PoolClient,
  binding: CaptureBinding,
  input: AgentSettingsUpdateDto,
  digest: Buffer,
): Promise<AgentSettingsSaveReplayDto | undefined> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(agentSettingsSaveReceipts)
      .where(eq(agentSettingsSaveReceipts.saveId, input.save_id)),
  )
  const receipt = rows[0]
  if (!receipt) {
    return undefined
  }
  const sameScope =
    receipt.actorId === binding.actorId &&
    receipt.targetId === binding.targetId &&
    receipt.targetContextId === binding.targetContextId
  const sameRequest =
    receipt.payloadSha256.equals(digest) && receipt.baseRevision === BigInt(input.expected_revision)
  if (!sameScope || !sameRequest) {
    fail('save_receipt_mismatch', 409)
  }
  return { save_id: receipt.saveId, revision: receipt.revision.toString(), replayed: true }
}

/**
 * The scope's revision and the highest revision whose receipt may have been pruned. A save with
 * no receipt sent over an older revision may have applied and lost its receipt, so its outcome
 * can't be told.
 */
async function receiptState(client: PoolClient, binding: CaptureBinding) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ revision: agentSettings.revision, through: agentSettings.receiptsPrunedThrough })
      .from(agentSettings)
      .where(settingsScope(binding)),
  )
  return { revision: rows[0]?.revision ?? 0n, prunedThrough: rows[0]?.through ?? 0n }
}

/**
 * Writes the save's receipt. The ID is unique across scopes, whose locks differ, so a reuse that
 * races a save in another scope is refused here and the whole save rolls back.
 */
async function writeReceipt(
  client: PoolClient,
  binding: CaptureBinding,
  input: AgentSettingsUpdateDto,
  digest: Buffer,
) {
  const baseRevision = BigInt(input.expected_revision)
  const written = await executeDatabaseQuery(
    queryDatabase(client)
      .insert(agentSettingsSaveReceipts)
      .values({
        saveId: input.save_id,
        actorId: binding.actorId,
        targetId: binding.targetId,
        targetContextId: binding.targetContextId,
        payloadSha256: digest,
        baseRevision,
        revision: baseRevision + 1n,
      })
      .onConflictDoNothing()
      .returning({ saveId: agentSettingsSaveReceipts.saveId }),
  )
  if (!written.length) {
    fail('save_receipt_mismatch', 409)
  }
}

/**
 * Drops receipts beyond the newest kept or past their age, advancing the scope's watermark. Age
 * is measured now, not when the transaction began, since a save may have waited for the lock.
 */
async function pruneReceipts(client: PoolClient, binding: CaptureBinding, revision: bigint) {
  await client.query(
    `WITH pruned AS (
       DELETE FROM agent_settings_save_receipt
       WHERE actor_id = $1 AND target_id = $2 AND target_context_id = $3
         AND (revision <= $4 OR saved_at < clock_timestamp() - $5::interval)
       RETURNING revision
     )
     UPDATE agent_settings
     SET receipts_pruned_through = GREATEST(
       receipts_pruned_through,
       (SELECT max(revision) FROM pruned)
     )
     WHERE actor_id = $1 AND target_id = $2 AND target_context_id = $3
       AND EXISTS (SELECT 1 FROM pruned)`,
    [
      binding.actorId,
      binding.targetId,
      binding.targetContextId,
      (revision - BigInt(RECEIPTS_KEPT)).toString(),
      RECEIPT_MAX_AGE,
    ],
  )
}

/**
 * Saves the whole settings object under its expected revision, or answers a resend of a save
 * that already applied with its receipt. Under the scope's lock, the receipt is checked before
 * the revision, so a `revision_conflict` always means this save never applied.
 */
export async function saveAgentSettings(
  pool: Pool,
  binding: CaptureBinding,
  input: AgentSettingsUpdateDto,
): Promise<AgentSettingsDto | AgentSettingsSaveReplayDto> {
  validate('AgentSettingsUpdate', input)
  checkAgentSettings(input)
  const digest = submittedDigest(input)
  return transaction(pool, async (client) => {
    await lockSettingsScope(client, binding)
    // Receipts past their age are pruned first, so an idle scope never answers from one.
    await pruneReceipts(client, binding, (await receiptState(client, binding)).revision)
    const replay = await priorReceipt(client, binding, input, digest)
    if (replay) {
      return replay
    }
    if (BigInt(input.expected_revision) < (await receiptState(client, binding)).prunedThrough) {
      fail('save_outcome_unknown', 409)
    }
    await writeSettings(client, binding, input)
    await writeReceipt(client, binding, input, digest)
    await pruneReceipts(client, binding, BigInt(input.expected_revision) + 1n)
    return readAgentSettings(client, binding)
  })
}

/** Writes the settings row under the expected revision and the provider rows with it. */
async function writeSettings(
  client: PoolClient,
  binding: CaptureBinding,
  input: AgentSettingsUpdateDto,
) {
  const legacy = legacySelection(input)
  const fields = {
    defaultProvider: input.default_provider,
    stageSelections: input.stage_selections,
    sessionConcurrency: input.session_concurrency,
    newBatchInstructions: input.new_batch_instructions,
    partDescriptionStyle: input.part_description_style,
    autoTagsDefault: input.auto_tags_default,
    webPublicPages: input.web.public_pages,
    webPreferDatasheets: input.web.prefer_datasheets,
  }
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
          and(settingsScope(binding), eq(agentSettings.revision, BigInt(input.expected_revision))),
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
}

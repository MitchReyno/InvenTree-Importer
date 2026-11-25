import {
  bigint,
  boolean,
  customType,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import type {
  AgentSelectionDto,
  AgentSettingsDto,
  SessionInboxItemDto,
  SessionOutboxItemDto,
  SessionStateDto,
} from '@invimport/contracts'

/** What a held slot's turn may have started outside its worker; see migration 0039. */
export type TurnChildKind = 'none' | 'host' | 'vm'

type AgentStageSelectionsDto = AgentSettingsDto['stage_selections']

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const agentSettings = pgTable(
  'agent_settings',
  {
    actorId: uuid('actor_id').notNull(),
    targetId: uuid('target_id').notNull(),
    targetContextId: uuid('target_context_id').notNull(),
    revision: bigint({ mode: 'bigint' }).notNull(),
    provider: text().$type<AgentSelectionDto['provider']>().notNull(),
    authentication: text().$type<AgentSelectionDto['authentication']>().notNull(),
    model: text().notNull(),
    sessionConcurrency: smallint('session_concurrency').notNull().default(3),
    defaultProvider: text('default_provider').$type<AgentSelectionDto['provider']>(),
    stageSelections: jsonb('stage_selections')
      .$type<AgentStageSelectionsDto>()
      .notNull()
      .default({}),
    newBatchInstructions: text('new_batch_instructions').notNull().default(''),
    partDescriptionStyle: text('part_description_style').notNull().default(''),
    autoTagsDefault: boolean('auto_tags_default').notNull().default(false),
    webPublicPages: boolean('web_public_pages').notNull().default(true),
    webPreferDatasheets: boolean('web_prefer_datasheets').notNull().default(true),
    /** The highest revision whose save receipt has been pruned; 0 while none has. */
    receiptsPrunedThrough: bigint('receipts_pruned_through', { mode: 'bigint' })
      .notNull()
      .default(0n),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.targetId, table.targetContextId] })],
)
/** One per applied settings save, written in the save's transaction and pruned per scope. */
export const agentSettingsSaveReceipts = pgTable('agent_settings_save_receipt', {
  saveId: uuid('save_id').primaryKey(),
  actorId: uuid('actor_id').notNull(),
  targetId: uuid('target_id').notNull(),
  targetContextId: uuid('target_context_id').notNull(),
  payloadSha256: bytea('payload_sha256').notNull(),
  baseRevision: bigint('base_revision', { mode: 'bigint' }).notNull(),
  revision: bigint({ mode: 'bigint' }).notNull(),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
})
/** One row per provider, written with its parent `agent_settings` row and under its revision. */
export const agentProviderSettings = pgTable(
  'agent_provider_settings',
  {
    actorId: uuid('actor_id').notNull(),
    targetId: uuid('target_id').notNull(),
    targetContextId: uuid('target_context_id').notNull(),
    provider: text().$type<AgentSelectionDto['provider']>().notNull(),
    enabled: boolean().notNull(),
    authentication: text().$type<AgentSelectionDto['authentication']>().notNull(),
    defaultModel: text('default_model').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.actorId, table.targetId, table.targetContextId, table.provider],
    }),
  ],
)
export const agentSessions = pgTable('agent_session', {
  attemptId: uuid('attempt_id').primaryKey(),
  queuedAt: timestamp('queued_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  nativeSessionId: text('native_session_id'),
  actualModel: text('actual_model'),
  progress: text()
    .$type<'queued' | 'starting' | 'responding' | 'settled'>()
    .notNull()
    .default('queued'),
  /** Session profiles only; `/1` rows keep these null. */
  sessionState: text('session_state').$type<SessionStateDto>(),
  sessionLineageId: uuid('session_lineage_id'),
  capabilitySha256: bytea('capability_sha256'),
  turnCount: bigint('turn_count', { mode: 'bigint' }).notNull().default(0n),
  queuedSince: timestamp('queued_since', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
})

export const agentSessionOutbox = pgTable(
  'agent_session_outbox',
  {
    sessionId: uuid('session_id').notNull(),
    seq: bigint({ mode: 'bigint' }).notNull(),
    kind: text().$type<SessionOutboxItemDto['kind']>().notNull(),
    payload: jsonb().$type<SessionOutboxItemDto['payload']>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.seq] })],
)

export const agentSessionInbox = pgTable('agent_session_inbox', {
  id: uuid().primaryKey(),
  sessionLineageId: uuid('session_lineage_id').notNull(),
  seq: bigint({ mode: 'bigint' }).notNull(),
  kind: text().$type<SessionInboxItemDto['kind']>().notNull(),
  payload: jsonb().$type<SessionInboxItemDto['payload']>().notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  actorId: uuid('actor_id'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
})

export const agentSessionCursors = pgTable('agent_session_cursor', {
  sessionLineageId: uuid('session_lineage_id').primaryKey(),
  ackedSeq: bigint('acked_seq', { mode: 'bigint' }).notNull().default(0n),
  ackedAt: timestamp('acked_at', { withTimezone: true }),
})

/** One cursor advance: the inbox sequences in (from_seq, to_seq] it acknowledged, and when. */
export const agentSessionAcks = pgTable(
  'agent_session_ack',
  {
    sessionLineageId: uuid('session_lineage_id').notNull(),
    fromSeq: bigint('from_seq', { mode: 'bigint' }).notNull(),
    toSeq: bigint('to_seq', { mode: 'bigint' }).notNull(),
    /** Null for the baseline of a cursor acknowledged before advances were logged. */
    ackedAt: timestamp('acked_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.sessionLineageId, table.toSeq] })],
)

export const agentSlots = pgTable(
  'agent_slot',
  {
    actorId: uuid('actor_id').notNull(),
    slotIndex: smallint('slot_index').notNull(),
    attemptId: uuid('attempt_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    /** The turn holding the slot, and what it may have started outside its worker. */
    turn: bigint('turn', { mode: 'bigint' }),
    turnChild: text('turn_child').$type<TurnChildKind>(),
    /** For a VM turn, the exact command sent to the guest. */
    vmCommand: text('vm_command'),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.slotIndex] })],
)

/** A batch whose agent sessions start no new work until resumed. */
export const agentBatchPauses = pgTable('agent_batch_pause', {
  batchId: uuid('batch_id').primaryKey(),
  actorId: uuid('actor_id').notNull(),
  pausedAt: timestamp('paused_at', { withTimezone: true }).notNull().defaultNow(),
})

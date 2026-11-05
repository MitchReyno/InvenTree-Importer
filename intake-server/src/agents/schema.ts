import {
  bigint,
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
  SessionInboxItemDto,
  SessionOutboxItemDto,
  SessionStateDto,
} from '@invimport/contracts'

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
  },
  (table) => [primaryKey({ columns: [table.actorId, table.targetId, table.targetContextId] })],
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

export const agentSlots = pgTable(
  'agent_slot',
  {
    actorId: uuid('actor_id').notNull(),
    slotIndex: smallint('slot_index').notNull(),
    attemptId: uuid('attempt_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.slotIndex] })],
)

import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  customType,
  primaryKey,
} from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

// Reviewed SQL owns constraints/cycles/triggers. These declarations supply exact driver row types.
export const commands = pgTable('command', {
  id: uuid().primaryKey(),
  actorId: uuid('actor_id').notNull(),
  targetId: uuid('target_id').notNull(),
  targetContextId: uuid('target_context_id').notNull(),
  kind: text().notNull(),
  handlerVersion: text('handler_version').notNull(),
  workflowId: text('workflow_id').notNull(),
  queueName: text('queue_name').notNull(),
  payloadBytes: bytea('payload_bytes').notNull(),
  payloadDigest: bytea('payload_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const outbox = pgTable('outbox', {
  commandId: uuid('command_id').primaryKey(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  deliveryAttempts: integer('delivery_attempts').notNull().default(0),
  ackedAt: timestamp('acked_at', { withTimezone: true }),
  conflictCode: text('conflict_code'),
})

export const idempotencyRecords = pgTable(
  'idempotency_record',
  {
    actorId: uuid('actor_id').notNull(),
    action: text().notNull(),
    resourceKey: text('resource_key').notNull(),
    key: text().notNull(),
    semanticBytes: bytea('semantic_bytes').notNull(),
    semanticDigest: bytea('semantic_digest').notNull(),
    responseBytes: bytea('response_bytes').notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.action, table.resourceKey, table.key] })],
)

export const streams = pgTable('ui_stream', {
  id: uuid().primaryKey(),
  streamKey: text('stream_key').notNull(),
  head: bigint({ mode: 'bigint' }).notNull(),
})

export const events = pgTable(
  'ui_event',
  {
    streamId: uuid('stream_id').notNull(),
    sequence: bigint({ mode: 'bigint' }).notNull(),
    kind: text().notNull(),
    publicBytes: bytea('public_bytes').notNull(),
  },
  (table) => [primaryKey({ columns: [table.streamId, table.sequence] })],
)

export type CommandRow = typeof commands.$inferSelect

export const targets = pgTable('target', {
  id: uuid('id').primaryKey(),
  currentContextId: uuid('current_context_id'),
  revision: bigint('revision', { mode: 'bigint' }).notNull().default(1n),
  profile: text('profile').notNull(),
})

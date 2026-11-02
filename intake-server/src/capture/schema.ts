import {
  jsonb,
  bigint,
  customType,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

// Reviewed migration SQL owns constraints, triggers and indexes; these are driver row types.
export const captureLotLineages = pgTable(
  'capture_lot_lineage',
  {
    batchId: uuid('batch_id').notNull(),
    predecessorLotId: uuid('predecessor_lot_id').notNull(),
    successorLotId: uuid('successor_lot_id').notNull(),
    action: text().$type<'split' | 'merge'>().notNull(),
    revision: bigint({ mode: 'bigint' }).notNull(),
    actorId: uuid('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.predecessorLotId, table.successorLotId] })],
)

export const captureLotRetirements = pgTable('capture_lot_retirement', {
  batchId: uuid('batch_id').notNull(),
  lotId: uuid('lot_id').primaryKey(),
  revision: bigint({ mode: 'bigint' }).notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureIssueDispositions = pgTable('capture_issue_disposition', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  code: text().notNull(),
  dependencyDigest: bytea('dependency_digest').notNull(),
  reason: text().notNull(),
  revision: bigint({ mode: 'bigint' }).notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureInstructions = pgTable('capture_instruction', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  groupId: uuid('group_id'),
  version: bigint({ mode: 'bigint' }).notNull(),
  text: text().notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureObservations = pgTable('capture_observation', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  targetId: uuid('target_id').notNull(),
  targetContextId: uuid('target_context_id').notNull(),
  model: text('model').notNull(),
  pk: text('pk').notNull(),
  label: text('label').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  mapping: jsonb('mapping'),
})

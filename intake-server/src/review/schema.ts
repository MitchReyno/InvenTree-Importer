import { bigint, customType, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

// Reviewed migrations own constraints, triggers and grants; these are driver mappings.

export const manualReviews = pgTable('manual_review', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  dependencyBytes: bytea('dependency_bytes').notNull(),
  dependencyDigest: bytea('dependency_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const manualPreparations = pgTable('manual_preparation', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  prepareCommandId: uuid('prepare_command_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  targetRevision: bigint('target_revision', { mode: 'bigint' }).notNull(),
  planBytes: bytea('plan_bytes').notNull(),
  planDigest: bytea('plan_digest').notNull(),
  reviewBytes: bytea('review_bytes').notNull(),
  reviewDigest: bytea('review_digest').notNull(),
  dependencyBytes: bytea('dependency_bytes').notNull(),
  dependencyDigest: bytea('dependency_digest').notNull(),
  previewBytes: bytea('preview_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const manualApprovals = pgTable('manual_approval', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  preparationId: uuid('preparation_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  roundNumber: bigint('round_number', { mode: 'bigint' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const manualPreparationLots = pgTable(
  'manual_preparation_lot',
  {
    batchId: uuid('batch_id').notNull(),
    preparationId: uuid('preparation_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    contributionKey: uuid('contribution_key').notNull(),
  },
  (table) => [primaryKey({ columns: [table.preparationId, table.lotId] })],
)

export const manualPreparationMedia = pgTable(
  'manual_preparation_media',
  {
    batchId: uuid('batch_id').notNull(),
    preparationId: uuid('preparation_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    manifestBytes: bytea('manifest_bytes').notNull(),
    manifestDigest: bytea('manifest_digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.batchId, table.preparationId, table.subjectId] })],
)

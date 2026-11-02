import { bigint, customType, pgTable, text, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core'

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

export const manualPrepareCommands = pgTable('manual_prepare_command', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  deploymentId: uuid('deployment_id').notNull(),
  targetId: uuid('target_id').notNull(),
  contextId: uuid('context_id').notNull(),
  dependencyBytes: bytea('dependency_bytes').notNull(),
  dependencyDigest: bytea('dependency_digest').notNull(),
  reviewBytes: bytea('review_bytes').notNull(),
  reviewDigest: bytea('review_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const manualReadIntents = pgTable('manual_read_intent', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  prepareCommandId: uuid('prepare_command_id').notNull(),
  model: text()
    .$type<
      'part' | 'location' | 'category' | 'parameter_template' | 'category_parameter' | 'company'
    >()
    .notNull(),
  pk: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const manualReadResults = pgTable('manual_read_result', {
  intentId: uuid('intent_id').primaryKey(),
  outcome: text().$type<'found' | 'unavailable'>().notNull(),
  receiptBytes: bytea('receipt_bytes').notNull(),
  receiptDigest: bytea('receipt_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const manualPreparationReviews = pgTable(
  'manual_preparation_review',
  {
    batchId: uuid('batch_id').notNull(),
    preparationId: uuid('preparation_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    reviewId: uuid('review_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.preparationId, table.subjectId] })],
)

export const manualPrepareOutcomes = pgTable('manual_prepare_outcome', {
  commandId: uuid('command_id').primaryKey(),
  responseBytes: bytea('response_bytes').notNull(),
  responseDigest: bytea('response_digest').notNull(),
})

export const manualRuns = pgTable('manual_run', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  approvalId: uuid('approval_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  streamId: uuid('stream_id').notNull(),
  revision: bigint({ mode: 'bigint' }).notNull().default(1n),
})

export const manualDispatches = pgTable('manual_dispatch', {
  id: uuid().primaryKey(),
  sequence: bigint({ mode: 'bigint' }).generatedAlwaysAsIdentity().notNull(),
  runId: uuid('run_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  commandId: uuid('command_id').notNull(),
  recoveryBytes: bytea('recovery_bytes').notNull(),
  recoveryDigest: bytea('recovery_digest').notNull(),
  state: text()
    .$type<'queued' | 'running' | 'finished' | 'interrupted'>()
    .notNull()
    .default('queued'),
  safeCode: text('safe_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

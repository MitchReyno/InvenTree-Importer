import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  customType,
  primaryKey,
} from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

// Migration 0010 owns composite constraints, immutable triggers and narrow grants.
export const supportedOperations = pgTable(
  'executor_supported_operation',
  {
    runId: uuid('run_id').notNull(),
    operationKey: uuid('operation_key').notNull(),
    partSubjectId: uuid('part_subject_id'),
    kind: text().notNull(),
    specBytes: bytea('spec_bytes').notNull(),
    specDigest: bytea('spec_digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.operationKey] })],
)

export const partTransfers = pgTable(
  'executor_part_transfer',
  {
    targetId: uuid('target_id').notNull(),
    originalKey: uuid('original_key').notNull(),
    partSubjectId: uuid('part_subject_id').notNull(),
    destinationKey: text('destination_key').notNull(),
    versionId: uuid('version_id').notNull(),
    blobDigest: bytea('blob_digest').notNull(),
    runId: uuid('run_id').notNull(),
    operationKey: uuid('operation_key').notNull(),
    artifactKey: uuid('artifact_key').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.targetId,
        table.originalKey,
        table.partSubjectId,
        table.destinationKey,
        table.versionId,
        table.blobDigest,
      ],
    }),
  ],
)

export const partIdentities = pgTable(
  'executor_part_identity',
  {
    targetId: uuid('target_id').notNull(),
    originalKey: uuid('original_key').notNull(),
    partSubjectId: uuid('part_subject_id').notNull(),
    runId: uuid('run_id').notNull(),
    operationKey: uuid('operation_key').notNull(),
    specDigest: bytea('spec_digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.targetId, table.originalKey, table.partSubjectId] })],
)

export const recordIdentities = pgTable(
  'executor_record_identity',
  {
    targetId: uuid('target_id').notNull(),
    originalKey: uuid('original_key').notNull(),
    draftId: uuid('draft_id').notNull(),
    kind: text().$type<'location' | 'company'>().notNull(),
    runId: uuid('run_id').notNull(),
    operationKey: uuid('operation_key').notNull(),
    specDigest: bytea('spec_digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.targetId, table.originalKey, table.draftId] })],
)

export const supportedRecoveries = pgTable('executor_supported_recovery', {
  id: uuid().primaryKey(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  actorId: uuid('actor_id').notNull(),
  cancelVersion: bigint('cancel_version', { mode: 'bigint' }).notNull(),
  kind: text().$type<'resume_effect' | 'verify_effect'>().notNull(),
})

export const supportedIntents = pgTable('executor_supported_intent', {
  id: uuid().primaryKey(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  recoveryId: uuid('recovery_id'),
  kind: text().$type<'read' | 'create' | 'verify'>().notNull(),
  attempt: integer().notNull(),
  requestBytes: bytea('request_bytes').notNull(),
  requestDigest: bytea('request_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supportedResults = pgTable('executor_supported_result', {
  intentId: uuid('intent_id').primaryKey(),
  outcome: text().$type<'response' | 'transport_loss' | 'proven_not_sent'>().notNull(),
  status: integer(),
  responseBytes: bytea('response_bytes'),
  responseDigest: bytea('response_digest'),
  responseSize: bigint('response_size', { mode: 'bigint' }),
})

export const supportedEffects = pgTable('executor_supported_effect', {
  intentId: uuid('intent_id').primaryKey(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  certainty: text().$type<'none' | 'unknown' | 'confirmed'>().notNull(),
  remotePks: text('remote_pks').array().notNull(),
})

export const supportedAssessments = pgTable('executor_supported_assessment', {
  id: uuid().primaryKey(),
  intentId: uuid('intent_id').notNull(),
  createIntentId: uuid('create_intent_id').notNull(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  outcome: text().$type<'matches' | 'missing_or_changed' | 'unavailable'>().notNull(),
  metadataIntentId: uuid('metadata_intent_id'),
  verifiedDigest: bytea('verified_digest'),
  observedModelId: text('observed_model_id'),
  remotePk: text('remote_pk').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const transferReadIntents = pgTable('manual_transfer_read_intent', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  prepareCommandId: uuid('prepare_command_id').notNull(),
  transferKey: uuid('transfer_key').notNull(),
  targetId: uuid('target_id').notNull(),
  contextId: uuid('context_id').notNull(),
  originalKey: uuid('original_key').notNull(),
  partSubjectId: uuid('part_subject_id').notNull(),
  destinationKey: text('destination_key').notNull(),
  versionId: uuid('version_id').notNull(),
  blobDigest: bytea('blob_digest').notNull(),
  originalRunId: uuid('original_run_id').notNull(),
  originalOperationKey: uuid('original_operation_key').notNull(),
  originalIntentId: uuid('original_intent_id').notNull(),
  kind: text().$type<'metadata' | 'file'>().notNull(),
  metadataParentId: uuid('metadata_parent_id'),
  requestBytes: bytea('request_bytes').notNull(),
  requestDigest: bytea('request_digest').notNull(),
})

export const transferReadResults = pgTable('manual_transfer_read_result', {
  intentId: uuid('intent_id').primaryKey(),
  outcome: text().$type<'verified' | 'unavailable'>().notNull(),
  status: integer(),
  responseBytes: bytea('response_bytes'),
  responseDigest: bytea('response_digest'),
  responseSize: bigint('response_size', { mode: 'bigint' }),
  receiptBytes: bytea('receipt_bytes').notNull(),
  receiptDigest: bytea('receipt_digest').notNull(),
})

export const executorDeployments = pgTable('executor_deployment', {
  id: uuid('id').primaryKey(),
  epoch: uuid('epoch').notNull(),
  targetId: uuid('target_id').notNull(),
  contextId: uuid('context_id').notNull(),
  origin: text('origin').notNull(),
  continuity: text('continuity').notNull(),
  build: text('build').notNull(),
  capability: text('capability').notNull(),
})

export const executorSources = pgTable(
  'executor_source',
  {
    targetId: uuid('target_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    originalKey: uuid('original_key').notNull(),
  },
  (table) => [primaryKey({ columns: [table.targetId, table.sourceId] })],
)

export const executorGuards = pgTable(
  'executor_guard',
  {
    targetId: uuid('target_id').notNull(),
    originalKey: uuid('original_key').notNull(),
    activeRun: uuid('active_run'),
  },
  (table) => [primaryKey({ columns: [table.targetId, table.originalKey] })],
)

export const executorApprovals = pgTable('executor_approval', {
  id: uuid('id').primaryKey(),
  preparationId: uuid('preparation_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  deploymentId: uuid('deployment_id').notNull(),
  targetId: uuid('target_id').notNull(),
  contextId: uuid('context_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  originalKey: uuid('original_key').notNull(),
  planBytes: bytea('plan_bytes').notNull(),
  planDigest: bytea('plan_digest').notNull(),
})

export const executorRuns = pgTable('executor_run', {
  id: uuid('id').primaryKey(),
  approvalId: uuid('approval_id').notNull(),
  commandId: uuid('command_id').notNull(),
  targetId: uuid('target_id').notNull(),
  originalKey: uuid('original_key').notNull(),
})

export const executorOperations = pgTable(
  'executor_operation',
  {
    runId: uuid('run_id').notNull(),
    operationKey: uuid('operation_key').notNull(),
    targetId: uuid('target_id').notNull(),
    originalKey: uuid('original_key').notNull(),
    contributionKey: uuid('contribution_key').notNull(),
    requestBytes: bytea('request_bytes').notNull(),
    requestDigest: bytea('request_digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.operationKey] })],
)

export const executorCancels = pgTable('executor_cancel', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  runId: uuid('run_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const executorRecoveries = pgTable('executor_recovery', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  actorId: uuid('actor_id').notNull(),
  cancelVersion: bigint('cancel_version', { mode: 'bigint' }).notNull(),
  kind: text('kind').notNull(),
})

export const executorIntents = pgTable('executor_intent', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  attempt: integer('attempt').notNull(),
  recoveryId: uuid('recovery_id'),
  kind: text('kind').notNull(),
  requestBytes: bytea('request_bytes').notNull(),
  requestDigest: bytea('request_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const executorResults = pgTable('executor_result', {
  intentId: uuid('intent_id').primaryKey(),
  outcome: text('outcome').notNull(),
  status: integer('status'),
  responseBytes: bytea('response_bytes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const executorEffects = pgTable('executor_effect', {
  intentId: uuid('intent_id').primaryKey(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  certainty: text('certainty').notNull(),
  remotePk: text('remote_pk'),
})

export const executorVerifications = pgTable('executor_verification', {
  intentId: uuid('intent_id').primaryKey(),
  effectIntentId: uuid('effect_intent_id').notNull(),
  runId: uuid('run_id').notNull(),
  operationKey: uuid('operation_key').notNull(),
  outcome: text('outcome').notNull(),
})

export const executorAttachments = pgTable(
  'executor_attachment',
  {
    runId: uuid('run_id').notNull(),
    artifactKey: uuid('artifact_key').notNull(),
    stockOperationKey: uuid('stock_operation_key').notNull(),
    requestBytes: bytea('request_bytes').notNull(),
    requestDigest: bytea('request_digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.artifactKey] })],
)

export const executorAttachmentRecoveries = pgTable('executor_attachment_recovery', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull(),
  artifactKey: uuid('artifact_key').notNull(),
  actorId: uuid('actor_id').notNull(),
  cancelVersion: bigint('cancel_version', { mode: 'bigint' }).notNull(),
  kind: text('kind').$type<'repair_attachment' | 'verify_attachment'>().notNull(),
  createIntentId: uuid('create_intent_id'),
})

export const executorAttachmentIntents = pgTable('executor_attachment_intent', {
  id: uuid().primaryKey(),
  runId: uuid('run_id').notNull(),
  artifactKey: uuid('artifact_key').notNull(),
  attempt: integer().notNull(),
  recoveryId: uuid('recovery_id'),
  kind: text()
    .$type<
      | 'create_attachment'
      | 'get_attachment'
      | 'download_attachment'
      | 'lookup_attachment'
      | 'get_stock'
    >()
    .notNull(),
  requestBytes: bytea('request_bytes').notNull(),
  requestDigest: bytea('request_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const executorAttachmentResults = pgTable('executor_attachment_result', {
  intentId: uuid('intent_id').primaryKey(),
  outcome: text().$type<'response' | 'transport_loss' | 'proven_not_sent'>().notNull(),
  status: integer(),
  responseBytes: bytea('response_bytes'),
  responseDigest: bytea('response_digest'),
  responseSize: bigint('response_size', { mode: 'bigint' }),
  remotePk: text('remote_pk'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const executorAttachmentEffects = pgTable('executor_attachment_effect', {
  intentId: uuid('intent_id').primaryKey(),
  runId: uuid('run_id').notNull(),
  artifactKey: uuid('artifact_key').notNull(),
  certainty: text().$type<'unknown' | 'none'>().notNull(),
  remotePk: text('remote_pk'),
})

export const executorAttachmentVerifications = pgTable('executor_attachment_verification', {
  id: uuid().primaryKey(),
  intentId: uuid('intent_id').notNull(),
  createIntentId: uuid('create_intent_id').notNull(),
  runId: uuid('run_id').notNull(),
  artifactKey: uuid('artifact_key').notNull(),
  outcome: text().$type<'matches' | 'missing_or_changed' | 'unavailable'>().notNull(),
  remotePk: text('remote_pk'),
  verifiedDigest: bytea('verified_digest'),
  observedStockPk: text('observed_stock_pk'),
  observedArtifactKey: uuid('observed_artifact_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

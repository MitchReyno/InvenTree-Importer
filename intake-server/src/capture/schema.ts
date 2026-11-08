import {
  boolean,
  jsonb,
  bigint,
  customType,
  integer,
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

export const captureBatches = pgTable('capture_batch', {
  id: uuid().primaryKey(),
  sourceId: uuid('source_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  targetId: uuid('target_id').notNull(),
  targetContextId: uuid('target_context_id').notNull(),
  streamId: uuid('stream_id').notNull(),
  title: text().notNull(),
  revision: bigint({ mode: 'bigint' }).notNull().default(1n),
  archived: boolean().notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureSubjects = pgTable('capture_subject', {
  batchId: uuid('batch_id').notNull(),
  id: uuid().primaryKey(),
  kind: text().$type<'lot' | 'part'>().notNull(),
  label: text().notNull(),
  revision: bigint({ mode: 'bigint' }).notNull().default(1n),
  agentSessionId: uuid('agent_session_id'),
})

export const captureSources = pgTable('capture_source', {
  id: uuid().primaryKey(),
  namespaceKey: text('namespace_key').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureParts = pgTable('capture_part', {
  batchId: uuid('batch_id').notNull(),
  id: uuid().primaryKey(),
  kind: text().$type<'part'>().notNull().default('part'),
})

export const captureLots = pgTable('capture_lot', {
  batchId: uuid('batch_id').notNull(),
  id: uuid().primaryKey(),
  kind: text().$type<'lot'>().notNull().default('lot'),
  sourceId: uuid('source_id').notNull(),
  contributionKey: uuid('contribution_key').notNull(),
  partSubjectId: uuid('part_subject_id'),
  origin: text().$type<'agent' | 'operator'>().notNull().default('operator'),
  agentSessionId: uuid('agent_session_id'),
  operatorEdited: boolean('operator_edited').notNull().default(false),
  /** The operator corrected a reading this lot used; cleared when the lead session looks again. */
  reexamine: boolean().notNull().default(false),
  excludedReason: text('excluded_reason'),
  excludedAt: timestamp('excluded_at', { withTimezone: true }),
  /** Set by the database on insert; null for lots formed before it was kept. */
  formedAt: timestamp('formed_at', { withTimezone: true }),
  estimatedQuantity: text('estimated_quantity'),
  quantityBasis: text('quantity_basis'),
  observationSetVersion: bigint('observation_set_version', { mode: 'bigint' })
    .notNull()
    .default(0n),
  changedRevision: bigint('changed_revision', { mode: 'bigint' }).notNull().default(1n),
})

/** An item seen in one region of one evidence version (not an inventory `capture_observation`). */
export const captureEvidenceObservations = pgTable('capture_evidence_observation', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  evidenceVersionId: uuid('evidence_version_id').notNull(),
  page: integer().notNull().default(1),
  region: jsonb().$type<Record<string, unknown>>().notNull(),
  readings: jsonb().$type<Record<string, unknown>>().notNull(),
  visibleCount: integer('visible_count'),
  /** The observation of the same lot this one shows again; it counts once. */
  sameItemAs: uuid('same_item_as'),
  status: text().$type<'active' | 'suggested'>().notNull().default('active'),
  supersedesObservationId: uuid('supersedes_observation_id'),
  origin: text().$type<'agent' | 'operator'>().notNull(),
  agentSessionId: uuid('agent_session_id'),
  operatorEdited: boolean('operator_edited').notNull().default(false),
  revision: bigint({ mode: 'bigint' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureLotEvidenceObservations = pgTable(
  'capture_lot_evidence_observation',
  {
    batchId: uuid('batch_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    evidenceObservationId: uuid('evidence_observation_id').notNull(),
    status: text().$type<'active' | 'suggested'>().notNull().default('active'),
    agentSessionId: uuid('agent_session_id'),
    revision: bigint({ mode: 'bigint' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.lotId, table.evidenceObservationId] })],
)

export const captureNotes = pgTable('capture_note', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  subjectId: uuid('subject_id'),
  text: text().notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureSelections = pgTable('capture_selection', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  subjectId: uuid('subject_id'),
  field: text().$type<'quantity' | 'location' | 'choice'>().notNull(),
  version: bigint({ mode: 'bigint' }).notNull(),
  value: jsonb().notNull(),
  observationId: uuid('observation_id'),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureRevisions = pgTable(
  'capture_revision',
  {
    batchId: uuid('batch_id').notNull(),
    revision: bigint({ mode: 'bigint' }).notNull(),
    actorId: uuid('actor_id').notNull(),
    commandBytes: bytea('command_bytes').notNull(),
    commandDigest: bytea('command_digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    agentSessionId: uuid('agent_session_id'),
  },
  (table) => [primaryKey({ columns: [table.batchId, table.revision] })],
)

export const captureEditPublications = pgTable('capture_edit_publication', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
})

export const captureContexts = pgTable('capture_context', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  subjectId: uuid('subject_id'),
  version: bigint({ mode: 'bigint' }).notNull(),
  value: jsonb().notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureSettingsIntents = pgTable('capture_settings_intent', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  version: bigint({ mode: 'bigint' }).notNull(),
  value: jsonb().notNull(),
  defaultLocationDraftId: uuid('default_location_draft_id'),
  defaultLocationDraftKind: text('default_location_draft_kind').$type<'location'>(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureGroupLocations = pgTable('capture_group_location', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  groupId: uuid('group_id').notNull(),
  version: bigint({ mode: 'bigint' }).notNull(),
  value: jsonb().notNull(),
  observationId: uuid('observation_id'),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureSettingNotes = pgTable('capture_setting_note', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  scope: text().$type<'batch' | 'order'>().notNull(),
  version: bigint({ mode: 'bigint' }).notNull(),
  text: text(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captureReferenceDraftIdentities = pgTable(
  'capture_reference_draft_identity',
  {
    batchId: uuid('batch_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    kind: text().$type<'location' | 'company'>().notNull(),
    actorId: uuid('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.batchId, table.draftId] })],
)

export const captureReferenceDrafts = pgTable('capture_reference_draft', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  draftId: uuid('draft_id').notNull(),
  kind: text().$type<'location' | 'company'>().notNull(),
  version: bigint({ mode: 'bigint' }).notNull(),
  value: jsonb().notNull(),
  retired: boolean().notNull(),
  logoEvidenceId: uuid('logo_evidence_id'),
  logoVersionId: uuid('logo_version_id'),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

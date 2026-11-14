import { bigint, customType, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type {
  ProcessingInputV1Dto,
  ProcessingQuestionDto,
  ProcessingRelianceDto,
  ProcessingStateDto,
} from '@invimport/contracts'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

// Reviewed migration SQL owns constraints, lineage, cycles and triggers; these are driver row types.
export const processingProfileRecords = pgTable('processing_profile', {
  id: text().primaryKey(),
  qualification: text().$type<'fixture_only' | 'native_unverified'>().notNull(),
  handlerVersion: text('handler_version').notNull(),
  instructionBytes: bytea('instruction_bytes').notNull(),
  instructionDigest: bytea('instruction_digest').notNull(),
  toolProfileVersion: text('tool_profile_version').notNull(),
})

export const processingInputs = pgTable('processing_input', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  parentId: uuid('parent_id'),
  captureRevision: bigint('capture_revision', { mode: 'bigint' }).notNull(),
  manifestBytes: bytea('manifest_bytes').notNull(),
  manifestDigest: bytea('manifest_digest').notNull(),
})

export const processingJobs = pgTable('processing_job', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  // Only the session profiles' batch-level Examine job has a null subject; its reads arrive
  // with the lead session, so subject jobs keep this narrower row type until then.
  /** Null only for the batch-level Examine lead job. */
  subjectId: uuid('subject_id'),
  stage: text().$type<ProcessingInputV1Dto['stage'] | 'examine'>().notNull(),
  revision: bigint({ mode: 'bigint' }).notNull().default(1n),
  currentAttemptId: uuid('current_attempt_id').notNull(),
  state: text().$type<ProcessingStateDto>().notNull(),
})

export const processingAttempts = pgTable('processing_attempt', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  jobId: uuid('job_id').notNull(),
  number: bigint({ mode: 'bigint' }).notNull(),
  inputId: uuid('input_id').notNull(),
  profileId: text('profile_id').notNull(),
  commandId: uuid('command_id').notNull(),
  channelDigest: bytea('channel_digest').notNull(),
  state: text().$type<ProcessingStateDto>().notNull(),
  lastSequence: bigint('last_sequence', { mode: 'bigint' }).notNull().default(0n),
})

export const processingDependencies = pgTable('processing_dependency', {
  batchId: uuid('batch_id').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  dependencyAttemptId: uuid('dependency_attempt_id').notNull(),
})

export const processingLanes = pgTable('processing_lane', {
  actorId: uuid('actor_id').primaryKey(),
  attemptId: uuid('attempt_id'),
})

export const processingMessages = pgTable('processing_message', {
  id: uuid().primaryKey(),
  attemptId: uuid('attempt_id').notNull(),
  sequence: bigint({ mode: 'bigint' }).notNull(),
  envelopeBytes: bytea('envelope_bytes').notNull(),
  envelopeDigest: bytea('envelope_digest').notNull(),
  disposition: text().$type<'accepted' | 'stale'>().notNull(),
})

export const processingProposals = pgTable('processing_proposal', {
  id: uuid().primaryKey(),
  attemptId: uuid('attempt_id').notNull(),
  messageId: uuid('message_id').notNull(),
  valueBytes: bytea('value_bytes').notNull(),
  valueDigest: bytea('value_digest').notNull(),
  /** Session proposals only: a projection of the retained value's `relies_on`. */
  reliesOn: jsonb('relies_on').$type<ProcessingRelianceDto>(),
})

export const processingProposalStale = pgTable('processing_proposal_stale', {
  proposalId: uuid('proposal_id').primaryKey(),
  reason: text()
    .$type<
      | 'source_superseded'
      | 'evidence_removed'
      | 'answer_received'
      | 'operator_correction'
      | 'lot_regrouped'
      | 'subject_retired'
    >()
    .notNull(),
  supersedingEventId: uuid('superseding_event_id'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
})

export const processingQuestions = pgTable('processing_question', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  jobId: uuid('job_id').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  messageId: uuid('message_id').notNull(),
  inputId: uuid('input_id').notNull(),
  revision: bigint({ mode: 'bigint' }).notNull().default(1n),
  state: text().$type<ProcessingQuestionDto['state']>().notNull(),
  specBytes: bytea('spec_bytes').notNull(),
  specDigest: bytea('spec_digest').notNull(),
  askedAt: timestamp('asked_at', { withTimezone: true, precision: 3 }).defaultNow(),
})

export const processingAnswers = pgTable('processing_answer', {
  id: uuid().primaryKey(),
  jobId: uuid('job_id').notNull(),
  questionId: uuid('question_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  valueBytes: bytea('value_bytes').notNull(),
  valueDigest: bytea('value_digest').notNull(),
  continuationAttemptId: uuid('continuation_attempt_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Session answers only: the capture revision their receipt returned. */
  captureRevision: bigint('capture_revision', { mode: 'bigint' }),
})

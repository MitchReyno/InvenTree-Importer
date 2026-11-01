import { bigint, customType, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import type {
  ProcessingJobDto,
  ProcessingQuestionDto,
  ProcessingStateDto,
} from '@invimport/contracts'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

// Reviewed migration SQL owns constraints, lineage, cycles and triggers; these are driver row types.
export const processingJobs = pgTable('processing_job', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  stage: text().$type<ProcessingJobDto['stage']>().notNull(),
  revision: bigint({ mode: 'bigint' }).notNull(),
  currentAttemptId: uuid('current_attempt_id').notNull(),
  state: text().$type<ProcessingStateDto>().notNull(),
})

export const processingAttempts = pgTable('processing_attempt', {
  id: uuid().primaryKey(),
  jobId: uuid('job_id').notNull(),
  inputId: uuid('input_id').notNull(),
  number: bigint({ mode: 'bigint' }).notNull(),
  commandId: uuid('command_id').notNull(),
  state: text().$type<ProcessingStateDto>().notNull(),
})

export const processingInputs = pgTable('processing_input', {
  id: uuid().primaryKey(),
  manifestBytes: bytea('manifest_bytes').notNull(),
  manifestDigest: bytea('manifest_digest').notNull(),
})

export const processingMessages = pgTable('processing_message', {
  id: uuid().primaryKey(),
  envelopeBytes: bytea('envelope_bytes').notNull(),
  envelopeDigest: bytea('envelope_digest').notNull(),
  disposition: text().notNull(),
})

export const processingQuestions = pgTable('processing_question', {
  id: uuid().primaryKey(),
  jobId: uuid('job_id').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  messageId: uuid('message_id').notNull(),
  inputId: uuid('input_id').notNull(),
  revision: bigint({ mode: 'bigint' }).notNull(),
  state: text().$type<ProcessingQuestionDto['state']>().notNull(),
  specBytes: bytea('spec_bytes').notNull(),
  specDigest: bytea('spec_digest').notNull(),
})

export const processingProposals = pgTable('processing_proposal', {
  id: uuid().primaryKey(),
  attemptId: uuid('attempt_id').notNull(),
  messageId: uuid('message_id').notNull(),
  valueBytes: bytea('value_bytes').notNull(),
  valueDigest: bytea('value_digest').notNull(),
})

export const processingLanes = pgTable('processing_lane', {
  actorId: uuid('actor_id').primaryKey(),
  attemptId: uuid('attempt_id'),
})

export const processingDependencies = pgTable('processing_dependency', {
  attemptId: uuid('attempt_id').notNull(),
  dependencyAttemptId: uuid('dependency_attempt_id').notNull(),
})

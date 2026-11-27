import { bigint, customType, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

/** Driver mappings of migration 0049's Match tables; the SQL is the DDL authority. */
export const processingMatches = pgTable('processing_match', {
  lotId: uuid('lot_id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  searchGeneration: bigint('search_generation', { mode: 'bigint' }).notNull(),
  settledGeneration: bigint('settled_generation', { mode: 'bigint' }).notNull().default(0n),
  outcomeRevision: bigint('outcome_revision', { mode: 'bigint' }).notNull().default(0n),
  state: text().$type<MatchRowState>().notNull(),
  waits: text().array().$type<('research' | 'images')[]>().notNull(),
  identityBytes: bytea('identity_bytes').notNull(),
  questionId: uuid('question_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
})

export type MatchRowState = 'searching' | 'unavailable' | 'clear' | 'question' | 'decided' | 'held'

export const processingMatchSearches = pgTable(
  'processing_match_search',
  {
    lotId: uuid('lot_id').notNull(),
    generation: bigint({ mode: 'bigint' }).notNull(),
    batchId: uuid('batch_id').notNull(),
    requestBytes: bytea('request_bytes').notNull(),
    requestDigest: bytea('request_digest').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    settlement: text().$type<'settled' | 'unavailable' | 'discarded'>(),
    resultBytes: bytea('result_bytes'),
    resultDigest: bytea('result_digest'),
    settledAt: timestamp('settled_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [primaryKey({ columns: [table.lotId, table.generation] })],
)

export const processingMatchOutcomes = pgTable(
  'processing_match_outcome',
  {
    lotId: uuid('lot_id').notNull(),
    revision: bigint({ mode: 'bigint' }).notNull(),
    generation: bigint({ mode: 'bigint' }).notNull(),
    outcomeBytes: bytea('outcome_bytes').notNull(),
    outcomeDigest: bytea('outcome_digest').notNull(),
    targetPartPk: text('target_part_pk'),
    coveredBytes: bytea('covered_bytes').notNull(),
    questionId: uuid('question_id'),
    recordedAt: timestamp('recorded_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.lotId, table.revision] })],
)

export const processingMatchQuestions = pgTable('processing_match_question', {
  id: uuid().primaryKey(),
  lotId: uuid('lot_id').notNull(),
  batchId: uuid('batch_id').notNull(),
  generation: bigint({ mode: 'bigint' }).notNull(),
  outcomeRevision: bigint('outcome_revision', { mode: 'bigint' }).notNull(),
  kind: text().$type<'candidates' | 'contribution' | 'unresolved' | 'target_lost'>().notNull(),
  questionBytes: bytea('question_bytes').notNull(),
  questionDigest: bytea('question_digest').notNull(),
  state: text().$type<'open' | 'answered' | 'superseded'>().notNull().default('open'),
  askedAt: timestamp('asked_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true, precision: 3 }),
})

export const processingMatchAnswers = pgTable('processing_match_answer', {
  questionId: uuid('question_id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  answerBytes: bytea('answer_bytes').notNull(),
  answerDigest: bytea('answer_digest').notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
})

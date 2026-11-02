import { bigint, customType, pgTable, text, uuid } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const researchReceipts = pgTable('research_receipt', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  commandId: uuid('command_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  targetId: uuid('target_id').notNull(),
  targetContextId: uuid('target_context_id').notNull(),
  requestId: uuid('request_id').notNull(),
  kind: text().$type<'web' | 'inventory'>().notNull(),
  sourceUrl: text('source_url'),
  mediaType: text('media_type').notNull(),
  byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
  bodyBytes: bytea('body_bytes').notNull(),
  bodyDigest: bytea('body_digest').notNull(),
  descriptorBytes: bytea('descriptor_bytes').notNull(),
  descriptorDigest: bytea('descriptor_digest').notNull(),
})

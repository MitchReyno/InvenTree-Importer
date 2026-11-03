import { bigint, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AgentSelectionDto } from '@invimport/contracts'

export const agentSettings = pgTable(
  'agent_settings',
  {
    actorId: uuid('actor_id').notNull(),
    targetId: uuid('target_id').notNull(),
    targetContextId: uuid('target_context_id').notNull(),
    revision: bigint({ mode: 'bigint' }).notNull(),
    provider: text().$type<AgentSelectionDto['provider']>().notNull(),
    authentication: text().$type<AgentSelectionDto['authentication']>().notNull(),
    model: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.targetId, table.targetContextId] })],
)
export const agentSessions = pgTable('agent_session', {
  attemptId: uuid('attempt_id').primaryKey(),
  queuedAt: timestamp('queued_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  nativeSessionId: text('native_session_id'),
  actualModel: text('actual_model'),
  progress: text()
    .$type<'queued' | 'starting' | 'responding' | 'settled'>()
    .notNull()
    .default('queued'),
})

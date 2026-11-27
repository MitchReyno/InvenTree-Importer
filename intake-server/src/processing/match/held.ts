import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { queryDatabase } from '#/db/database.ts'
import { processingJobs } from '#/processing/schema.ts'
import { processingMatches } from './schema.ts'

/**
 * Whether Match holds the lot stage of a `processing_job` row in the outer query: a search is
 * pending, a question or Something else holds the lot, its last search couldn't run, the
 * stage waits, or the outcome in force skips it. Such a session waits at its claim, so queue scans pass over it.
 */
export function matchHolds(db: ReturnType<typeof queryDatabase>): SQL {
  return sql`EXISTS (${db
    .select({ lotId: processingMatches.lotId })
    .from(processingMatches)
    .where(
      and(
        eq(processingMatches.lotId, processingJobs.subjectId),
        or(
          sql`${processingMatches.searchGeneration} > ${processingMatches.settledGeneration}`,
          inArray(processingMatches.state, ['question', 'held', 'unavailable']),
          sql`${processingJobs.stage} = ANY(${processingMatches.waits})`,
          // The outcome in force skips the stage, so its session never runs again.
          sql`EXISTS (SELECT 1 FROM public.processing_match_outcome o
                      WHERE o.lot_id=${processingMatches.lotId}
                        AND o.revision=${processingMatches.outcomeRevision}
                        AND convert_from(o.outcome_bytes,'UTF8')::jsonb #>> ARRAY[${processingJobs.stage}::text,'mode'] = 'skipped')`,
        ),
      ),
    )})`
}

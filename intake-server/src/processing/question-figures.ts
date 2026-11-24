import type { PoolClient } from 'pg'
import type { ProcessingQuestionFigureDto } from '@invimport/contracts'
import { versionRemovedSql } from '#/media/removal.ts'

type FigureState = Pick<
  ProcessingQuestionFigureDto,
  'state' | 'evidence_label' | 'document' | 'page_width' | 'page_height'
>
/** Each question's figures by question ID, then by 1-based figure index. */
export type FigureStates = Map<string, Map<number, FigureState>>

/**
 * How each of a job's question figures can be shown now: removed when its photo was removed from
 * Capture, otherwise as its view render stands. A render the sweep has gone reads as failed.
 */
export async function questionFigureStates(
  client: PoolClient,
  jobId: string,
): Promise<FigureStates> {
  const rows = await client.query<{
    question_id: string
    figure_index: number
    render_state: 'queued' | 'ready' | 'failed' | null
    removed: boolean
    document: boolean
    label: string
    page_width: number
    page_height: number
  }>(
    `SELECT f.question_id, f.figure_index, r.state AS render_state,
       ${versionRemovedSql('v')} AS removed, v.media_type='application/pdf' AS document, e.label,
       p.width AS page_width, p.height AS page_height
     FROM public.processing_question_figure f
     JOIN public.processing_question q ON q.id=f.question_id
     JOIN public.media_version v ON v.batch_id=f.batch_id AND v.id=f.version_id
     JOIN public.media_evidence e ON e.id=v.evidence_id
     JOIN public.media_preview p ON p.version_id=f.version_id AND p.page=f.page
     LEFT JOIN public.processing_figure_render r
       ON r.purpose='view' AND r.recipe_digest=f.recipe_digest
     WHERE q.job_id=$1`,
    [jobId],
  )
  const states: FigureStates = new Map()
  for (const row of rows.rows) {
    const figures = states.get(row.question_id) ?? new Map<number, FigureState>()
    figures.set(row.figure_index, {
      state: figureState(row.removed, row.render_state),
      evidence_label: row.label,
      document: row.document,
      page_width: row.page_width,
      page_height: row.page_height,
    })
    states.set(row.question_id, figures)
  }
  return states
}

function figureState(
  removed: boolean,
  render: 'queued' | 'ready' | 'failed' | null,
): ProcessingQuestionFigureDto['state'] {
  if (removed) {
    return 'removed'
  }
  if (render === 'queued') {
    return 'preparing'
  }
  if (render === 'ready') {
    return 'ready'
  }
  return 'failed'
}

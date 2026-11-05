import {
  MAX_ATTENTION_ITEMS,
  type AttentionItemDto,
  type BatchAttentionDto,
  type ManualWorkspaceDto,
  type OperatorReviewDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'

export type AttentionSources = {
  batchId: string
  /** Absent when this setup has no processing runner. */
  processing: ProcessingSnapshotDto | undefined
  review: OperatorReviewDto
  manual: ManualWorkspaceDto
}

/** Reading and Identifying are the Examine step on the redesigned Processing tab. */
const STEP_BY_STAGE: Record<string, string> = {
  reading: 'examine',
  identifying: 'examine',
  examine: 'examine',
  research: 'research',
  images: 'images',
  inventory: 'inventory',
}

const FAILED_RUN_STATES = new Set(['recovery_required', 'settled_incomplete'])
const UNCERTAIN_CERTAINTY = new Set(['unknown', 'mixed'])

function questionItems({ batchId, processing }: AttentionSources): AttentionItemDto[] {
  return (processing?.jobs ?? []).flatMap((job) =>
    job.questions
      .filter((question) => question.state === 'open')
      .map((question) => ({
        key: `question:${question.id}`,
        group: 'question' as const,
        tab: 'processing' as const,
        title: question.spec.prompt,
        detail: question.assumption ?? null,
        route: `${batchId}/processing/${STEP_BY_STAGE[job.stage] ?? 'overview'}/${question.id}`,
      })),
  )
}

function changedLotItems({ batchId, review }: AttentionSources): AttentionItemDto[] {
  return review.lots
    .filter((lot) => lot.review_state === 'changed_after_review')
    .map((lot) => ({
      key: `changed:${lot.lot_id}`,
      group: 'changed_lot' as const,
      tab: 'review' as const,
      title: lot.label,
      detail: 'Changed since it was reviewed',
      route: `${batchId}/review/lots/${lot.lot_id}`,
    }))
}

/** Until record decisions exist, an open blocking issue is the choice Review needs. */
function decisionItems({ batchId, review }: AttentionSources): AttentionItemDto[] {
  return review.lots.flatMap((lot) =>
    lot.issues
      .filter((issue) => issue.severity === 'blocking' && issue.disposition === null)
      .map((issue) => ({
        key: `decision:${lot.lot_id}:${issue.code}`,
        group: 'decision' as const,
        tab: 'review' as const,
        title: issue.message || lot.label,
        detail: lot.label,
        route: `${batchId}/review/lots/${lot.lot_id}`,
      })),
  )
}

function resultItems({ batchId, manual }: AttentionSources): AttentionItemDto[] {
  return manual.runs
    .filter(
      (run) => FAILED_RUN_STATES.has(run.state) || UNCERTAIN_CERTAINTY.has(run.effect_certainty),
    )
    .map((run) => ({
      key: `result:${run.run_id}`,
      group: 'result' as const,
      tab: 'changes' as const,
      title: FAILED_RUN_STATES.has(run.state)
        ? 'A run needs recovery'
        : 'Some changes may or may not have been applied',
      detail: null,
      route: `${batchId}/changes/added/${run.run_id}`,
    }))
}

/** Tab counts and need-you items from one set of reads, so badges and the panel agree. */
export function projectAttention(sources: AttentionSources): BatchAttentionDto {
  const questions = questionItems(sources)
  const changed = changedLotItems(sources)
  const decisions = decisionItems(sources)
  const results = resultItems(sources)
  const items = [...questions, ...changed, ...decisions, ...results]
  const failed = sources.manual.runs.filter((run) => FAILED_RUN_STATES.has(run.state)).length

  return {
    batch_id: sources.batchId,
    revision: sources.review.revision,
    processing: { questions: questions.length },
    review: {
      to_check: sources.review.lots.filter((lot) => lot.review_state !== 'reviewed').length,
      changed_after_review: changed.length,
      to_decide: decisions.length,
    },
    changes: {
      ready: sources.manual.lots.filter((lot) => lot.reviewed && lot.issues.length === 0).length,
      failed,
      uncertain: results.length - failed,
    },
    items: items.slice(0, MAX_ATTENTION_ITEMS),
    items_truncated: items.length > MAX_ATTENTION_ITEMS,
  }
}

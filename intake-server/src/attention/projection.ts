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

/** Issues the operator settles with a choice; the rest report status, such as approval or archive. */
const DECISION_CODES = new Set([
  'part_choice_required',
  'quantity_required',
  'location_required',
  'location_conflict',
  'location_draft_parent_invalid',
])

const STEP_LABEL: Record<string, string> = {
  examine: 'An Examine',
  research: 'A Research',
  images: 'An Images',
  inventory: 'An Inventory',
}

const FAILED_JOB_STATES = new Set(['failed', 'interrupted'])

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

function failedJobItems({ batchId, processing }: AttentionSources): AttentionItemDto[] {
  return (processing?.jobs ?? [])
    .filter((job) => FAILED_JOB_STATES.has(job.state))
    .map((job) => {
      const step = STEP_BY_STAGE[job.stage] ?? 'overview'
      const outcome = job.state === 'failed' ? 'failed' : 'was interrupted'

      return {
        key: `failed:${job.id}`,
        group: 'failed_job' as const,
        tab: 'processing' as const,
        title: `${STEP_LABEL[step] ?? 'A Processing'} attempt ${outcome}`,
        detail: null,
        route: `${batchId}/processing/${step}`,
      }
    })
}

function changedLotItems({ batchId, review }: AttentionSources): AttentionItemDto[] {
  return openLots(review)
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

/** Lots still to approve; an approved lot needs nothing more from Review. */
function openLots(review: OperatorReviewDto) {
  return review.lots.filter((lot) => !lot.approved)
}

/** Until record decisions exist, an open blocking choice is the decision Review needs. */
function decisionItems({ batchId, review }: AttentionSources): AttentionItemDto[] {
  return openLots(review).flatMap((lot) =>
    lot.issues
      .filter(
        (issue) =>
          issue.severity === 'blocking' &&
          issue.disposition === null &&
          DECISION_CODES.has(issue.code),
      )
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

const STEPS = ['examine', 'research', 'images', 'inventory'] as const

function stepWork(items: AttentionItemDto[]) {
  const step = (name: string) => {
    const own = items.filter((item) => item.route.split('/')[2] === name)
    return {
      questions: own.filter((item) => item.group === 'question').length,
      failed: own.filter((item) => item.group === 'failed_job').length,
    }
  }

  return Object.fromEntries(STEPS.map((name) => [name, step(name)])) as Record<
    (typeof STEPS)[number],
    { questions: number; failed: number }
  >
}

/** Tab counts and need-you items projected together, so badges and the panel agree. */
export function projectAttention(sources: AttentionSources): BatchAttentionDto {
  const questions = questionItems(sources)
  const failedJobs = failedJobItems(sources)
  const changed = changedLotItems(sources)
  const decisions = decisionItems(sources)
  const results = resultItems(sources)
  const items = [...questions, ...failedJobs, ...changed, ...decisions, ...results]
  const approved = new Set(
    sources.review.lots.filter((lot) => lot.approved).map((lot) => lot.lot_id),
  )
  const failed = sources.manual.runs.filter((run) => FAILED_RUN_STATES.has(run.state)).length

  return {
    batch_id: sources.batchId,
    revision: sources.review.revision,
    processing: {
      questions: questions.length,
      failed: failedJobs.length,
      steps: stepWork([...questions, ...failedJobs]),
    },
    review: {
      to_check: openLots(sources.review).filter((lot) => lot.review_state !== 'reviewed').length,
      changed_after_review: changed.length,
      to_decide: decisions.length,
    },
    changes: {
      ready: sources.manual.lots.filter(
        (lot) => lot.reviewed && lot.issues.length === 0 && !approved.has(lot.lot_id),
      ).length,
      failed,
      uncertain: results.length - failed,
    },
    items: items.slice(0, MAX_ATTENTION_ITEMS),
    items_truncated: items.length > MAX_ATTENTION_ITEMS,
  }
}

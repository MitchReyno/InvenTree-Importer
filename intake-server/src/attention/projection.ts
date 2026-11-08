import {
  MAX_ATTENTION_ITEMS,
  oldestQuestionFirst,
  type AttentionItemDto,
  type BatchAttentionDto,
  type BatchRecordsDto,
  type ManualWorkspaceDto,
  type OperatorReviewDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'

export type AttentionSources = {
  batchId: string
  processing: ProcessingSnapshotDto | undefined
  review: OperatorReviewDto
  manual: ManualWorkspaceDto
  records: BatchRecordsDto
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
  return (processing?.jobs ?? [])
    .flatMap((job) =>
      job.questions
        .filter((question) => question.state === 'open')
        .map((question) => ({ job, question })),
    )
    .sort((a, b) => oldestQuestionFirst(a.question, b.question))
    .map(({ job, question }) => ({
      key: `question:${question.id}`,
      group: 'question' as const,
      tab: 'processing' as const,
      title: question.spec.prompt,
      detail: question.assumption ?? null,
      route: `${batchId}/processing/${STEP_BY_STAGE[job.stage] ?? 'overview'}/${question.id}`,
    }))
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

/** A record waiting for a choice, as Review › Records counts it: once per record, not per lot. */
function decisionItems({ batchId, records }: AttentionSources): AttentionItemDto[] {
  return records.records
    .filter((record) => record.state === 'choose' || record.state === 'unsupported')
    .map((record) => ({
      key: `decision:${record.key}`,
      group: 'decision' as const,
      tab: 'review' as const,
      title:
        record.decision?.detail ??
        (record.state === 'unsupported' ? 'Not supported yet' : 'Needs a decision'),
      detail: record.label,
      route: `${batchId}/review/records/${record.type}/${encodeURIComponent(
        record.key.slice(record.type.length + 1),
      )}`,
    }))
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

type StepWork = { questions: number; failed: number; jobs: number; ready: number; running: number }

function stepWork(items: AttentionItemDto[], processing: ProcessingSnapshotDto | undefined) {
  const step = (name: string): StepWork => {
    const own = items.filter((item) => item.route.split('/')[2] === name)
    const jobs = (processing?.jobs ?? []).filter((job) => STEP_BY_STAGE[job.stage] === name)
    return {
      questions: own.filter((item) => item.group === 'question').length,
      failed: own.filter((item) => item.group === 'failed_job').length,
      jobs: jobs.length,
      ready: jobs.filter((job) => job.state === 'ready').length,
      running: jobs.filter((job) => job.state === 'running').length,
    }
  }

  return Object.fromEntries(STEPS.map((name) => [name, step(name)])) as Record<
    (typeof STEPS)[number],
    StepWork
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
      running: (sources.processing?.jobs ?? []).filter((job) => job.state === 'running').length,
      steps: stepWork([...questions, ...failedJobs], sources.processing),
    },
    review: {
      to_check: openLots(sources.review).filter((lot) => lot.review_state !== 'reviewed').length,
      changed_after_review: changed.length,
      to_decide: decisions.length,
      records: sources.records.records.length,
    },
    changes: {
      ready: sources.manual.lots.filter(
        (lot) => lot.reviewed && lot.issues.length === 0 && !approved.has(lot.lot_id),
      ).length,
      failed,
      uncertain: results.length - failed,
      runs: sources.manual.runs.length,
    },
    items: items.slice(0, MAX_ATTENTION_ITEMS),
    items_truncated: items.length > MAX_ATTENTION_ITEMS,
  }
}

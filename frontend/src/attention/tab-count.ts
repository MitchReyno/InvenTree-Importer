import type { BatchAttentionDto } from '@invimport/contracts'
import type { BatchTab, ProcessingStep } from '#/navigation/batch-route'
import { formatCount } from '#/components/ui'

type Step = Exclude<ProcessingStep, 'overview'>

/** A batch tab, or one of its sub-tabs as `<tab>/<view>`. */
export type TabKey =
  | BatchTab
  | `processing/${ProcessingStep}`
  | 'review/lots'
  | 'review/map'
  | 'review/records'
  | 'changes/ready'
  | 'changes/added'

/** `default` is a plain total; the others are the attention tones. */
export type TabCountTone = 'default' | 'warn' | 'ok' | 'bad'

/** One tab's only count: what it shows, its words for the accessible name, and its tone. */
export type TabCount = { value: string; label: string; tone: TabCountTone }

export type TabCountInput = {
  attention: BatchAttentionDto | undefined
  /** Active lots from the capture read, the Lots fallback. */
  activeLotCount: number
  /** Files no lot uses, from the media read; absent while lineage is unknown. */
  unusedFiles?: number
}

function count(value: number, words: string, tone: TabCountTone): TabCount {
  return { value: formatCount(value), label: `${value} ${words}`, tone }
}

function plural(value: number, one: string, many: string) {
  return value === 1 ? one : many
}

/** Questions first, then progress while the step is unfinished; a finished step shows its tick. */
function stepCount(step: BatchAttentionDto['processing']['steps'][Step]) {
  if (step.questions > 0) {
    return count(step.questions, plural(step.questions, 'question', 'questions'), 'warn')
  }
  if (step.jobs > 0 && step.ready < step.jobs) {
    return {
      value: `${step.ready}/${step.jobs}`,
      label: `${step.ready} of ${step.jobs} ready`,
      tone: 'default' as const,
    }
  }

  return undefined
}

/**
 * The one count a tab shows (design D3): the thing to act on in its attention tone when there is
 * one, otherwise its total. Capture and Overview show none; Review always shows lots to check,
 * because its sub-tabs carry the record decisions.
 */
export function tabCount(tab: TabKey, input: TabCountInput): TabCount | undefined {
  const { attention, activeLotCount, unusedFiles } = input
  if (tab === 'review/lots' && !attention) {
    return count(activeLotCount, plural(activeLotCount, 'lot', 'lots'), 'default')
  }
  if (!attention) {
    return undefined
  }
  const { processing, review, changes } = attention

  switch (tab) {
    case 'processing':
      return processing.questions > 0
        ? count(processing.questions, plural(processing.questions, 'question', 'questions'), 'warn')
        : undefined
    case 'processing/examine':
    case 'processing/research':
    case 'processing/images':
    case 'processing/inventory':
      return stepCount(processing.steps[tab.slice('processing/'.length) as Step])
    case 'review':
      return count(review.to_check, 'to check', 'default')
    case 'review/lots':
      return review.changed_after_review > 0
        ? count(review.changed_after_review, 'changed since review', 'warn')
        : count(activeLotCount, plural(activeLotCount, 'lot', 'lots'), 'default')
    case 'review/map':
      return unusedFiles
        ? count(unusedFiles, plural(unusedFiles, 'unused file', 'unused files'), 'warn')
        : undefined
    case 'review/records':
      return review.to_decide > 0
        ? count(review.to_decide, 'to decide', 'warn')
        : count(review.records, plural(review.records, 'record', 'records'), 'default')
    case 'changes':
    case 'changes/ready':
      return count(changes.ready, 'ready to add', 'ok')
    case 'changes/added': {
      const problems = changes.failed + changes.uncertain

      return problems > 0
        ? count(problems, plural(problems, 'needs attention', 'need attention'), 'bad')
        : undefined
    }
    default:
      // Capture and Processing › Overview carry no count.
      return undefined
  }
}

/** A step's status icon: a spinner while any attempt runs, a tick once every attempt is ready. */
export function stepStatus(step: Step, attention: BatchAttentionDto | undefined) {
  const work = attention?.processing.steps[step]
  if (!work) {
    return undefined
  }
  if (work.running > 0) {
    return 'running' as const
  }
  if (work.jobs > 0 && work.ready === work.jobs) {
    return 'done' as const
  }

  return undefined
}

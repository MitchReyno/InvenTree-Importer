import { locationDraftName } from '../capture/context'
import {
  lotLocationGroups,
  oldestQuestionFirst,
  resolveLotLocation,
  type CaptureSnapshotDto,
  type MediaSnapshotDto,
  type OperatorIssueDto,
  type OperatorLotDto,
  type OperatorReviewDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import { display } from '../capture/display'
import { batchHref, processingStepFor, type ProcessingStep } from '../navigation/batch-route'

export const REVIEW_FILTERS = [
  'all',
  'needs_review',
  'needs_answer',
  'blocking',
  'warnings',
  'changed',
  'reviewed',
  'excluded',
  'retired',
] as const

export type ReviewFilter = (typeof REVIEW_FILTERS)[number]
export type ReviewView = 'evidence' | 'table'

export const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: 'All',
  needs_review: 'Needs review',
  needs_answer: 'Needs answer',
  blocking: 'Blocking',
  warnings: 'Warnings',
  changed: 'Changed after review',
  reviewed: 'Reviewed',
  excluded: 'Excluded',
  retired: 'Retired',
}

export interface ReviewLocation {
  lotId: string | null
  view: ReviewView
  filter: ReviewFilter
}

/** Review URLs: `#<batch>/review/lots[/<lot>][?view=table&filter=warnings]`. */
export function parseReviewLocation(hash: string): ReviewLocation {
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query)
  const segments = path.split('/')
  const filter = params.get('filter')
  return {
    lotId: segments[1] === 'review' && segments[2] === 'lots' && segments[3] ? segments[3] : null,
    view: params.get('view') === 'table' ? 'table' : 'evidence',
    filter: REVIEW_FILTERS.includes(filter as ReviewFilter) ? (filter as ReviewFilter) : 'all',
  }
}

export function reviewHash(batchId: string, value: ReviewLocation): string {
  const params = new URLSearchParams()
  if (value.view !== 'evidence') {
    params.set('view', value.view)
  }
  if (value.filter !== 'all') {
    params.set('filter', value.filter)
  }
  const query = params.toString()
  return batchHref(
    batchId,
    { tab: 'review', view: 'lots', ...(value.lotId ? { lotId: value.lotId } : {}) },
    query ? `?${query}` : '',
  )
}

export function blockingIssues(lot: OperatorLotDto): OperatorIssueDto[] {
  return lot.issues.filter((issue) => issue.severity === 'blocking')
}

export function openWarnings(lot: OperatorLotDto): OperatorIssueDto[] {
  return lot.issues.filter((issue) => issue.severity === 'warning' && !issue.disposition)
}

export function dismissedWarnings(lot: OperatorLotDto): OperatorIssueDto[] {
  return lot.issues.filter((issue) => issue.severity === 'warning' && issue.disposition)
}

/** Lot ids with an open question; a lot-keyed map of questions also fits. */
export type LotIds = Pick<ReadonlySet<string>, 'has'>

const NO_QUESTIONS: LotIds = new Set()

export type OpenQuestion = {
  id: string
  step: ProcessingStep
  /** The question itself and the capture revision it was read at, for answering in place. */
  question: ProcessingSnapshotDto['jobs'][number]['questions'][number]
  captureRevision: string
}

/**
 * Each active lot's oldest open Processing question: its own, else its Part's, since a job can be
 * about a Part that several lots share.
 */
export function openQuestionsByLot(
  processing: ProcessingSnapshotDto | undefined,
  batch: Pick<CaptureSnapshotDto, 'lots'>,
): ReadonlyMap<string, OpenQuestion> {
  const bySubject = new Map<string, OpenQuestion>()
  const asked = (processing?.jobs ?? [])
    .flatMap((job) => job.questions.map((question) => ({ job, question })))
    .sort((a, b) => oldestQuestionFirst(a.question, b.question))
  for (const { job, question } of asked) {
    const subject = question.spec.subject_id
    if (question.state === 'open' && subject && !bySubject.has(subject)) {
      bySubject.set(subject, {
        id: question.id,
        step: processingStepFor(job.stage),
        question,
        captureRevision: processing!.capture_revision,
      })
    }
  }
  const byLot = new Map<string, OpenQuestion>()
  for (const lot of batch.lots) {
    const question =
      bySubject.get(lot.id) ??
      (lot.part_subject_id ? bySubject.get(lot.part_subject_id) : undefined)
    if (question) {
      byLot.set(lot.id, question)
    }
  }
  return byLot
}

export function matchesFilter(
  lot: OperatorLotDto,
  filter: ReviewFilter,
  questionLotIds: LotIds = NO_QUESTIONS,
): boolean {
  // An excluded lot waits on nothing but being included again.
  if (lot.excluded) {
    return filter === 'all' || filter === 'excluded'
  }
  switch (filter) {
    case 'all':
      return true
    case 'excluded':
      return false
    case 'needs_review':
      return lot.review_state !== 'reviewed' && !lot.approved
    case 'needs_answer':
      return questionLotIds.has(lot.lot_id)
    case 'blocking':
      return blockingIssues(lot).length > 0
    case 'warnings':
      return openWarnings(lot).length > 0
    case 'changed':
      return lot.review_state === 'changed_after_review'
    case 'reviewed':
      return lot.review_state === 'reviewed'
    case 'retired':
      return false
  }
}

export type QueueGroup =
  'blocking' | 'warnings' | 'changed' | 'needs_review' | 'reviewed' | 'approved' | 'excluded'

export const GROUP_LABELS: Record<QueueGroup, string> = {
  blocking: 'Blocking',
  warnings: 'Warnings to resolve',
  changed: 'Changed after review',
  needs_review: 'Needs review',
  reviewed: 'Reviewed',
  approved: 'Already approved',
  excluded: 'Excluded',
}

/** One queue group per lot, most urgent first. */
export function queueGroup(lot: OperatorLotDto): QueueGroup {
  if (lot.excluded) {
    return 'excluded'
  }
  if (lot.approved) {
    return 'approved'
  }
  if (blockingIssues(lot).length) {
    return 'blocking'
  }
  if (openWarnings(lot).length) {
    return 'warnings'
  }
  if (lot.review_state === 'changed_after_review') {
    return 'changed'
  }
  return lot.review_state === 'reviewed' ? 'reviewed' : 'needs_review'
}

export const GROUP_ORDER: QueueGroup[] = [
  'blocking',
  'warnings',
  'changed',
  'needs_review',
  'reviewed',
  'approved',
  'excluded',
]

/** Union of the operator projection and the capture snapshot's own retired flag. */
export function retiredLotIds(
  review: OperatorReviewDto | undefined,
  batch?: CaptureSnapshotDto,
): ReadonlySet<string> {
  const fromReview = review?.retired_lots.map((lot) => lot.lot_id) ?? []
  const fromSnapshot = batch?.lots.filter((lot) => lot.retired === true).map((lot) => lot.id) ?? []
  return new Set([...fromReview, ...fromSnapshot])
}

/** Lots already added to inventory. Adding is never undone, so an older accepted review still counts. */
export function approvedLotIds(
  current: OperatorReviewDto | undefined,
  accepted: OperatorReviewDto | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const review of [current, accepted]) {
    for (const lot of review?.lots ?? []) {
      if (lot.approved) {
        ids.add(lot.lot_id)
      }
    }
  }
  return ids
}

/** Each lot's direct predecessors, read from the retired lots' successors so every level is known. */
export function predecessorLotIds(
  review: OperatorReviewDto | undefined,
): ReadonlyMap<string, readonly string[]> {
  const predecessors = new Map<string, string[]>()
  for (const retired of review?.retired_lots ?? []) {
    for (const successor of retired.successor_lot_ids) {
      predecessors.set(successor, [...(predecessors.get(successor) ?? []), retired.lot_id])
    }
  }
  return predecessors
}

export type Provenance =
  | 'human'
  | 'inherited'
  | 'override'
  | 'unknown'
  | 'cleared'
  | 'unset'
  | 'shared_part'
  | 'evidence_group'
  | 'conflict'
  | 'unconfirmed'

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  human: 'Human set',
  inherited: 'Inherited default',
  override: 'Override',
  unknown: 'Unknown',
  cleared: 'Cleared',
  unset: 'Unset',
  shared_part: 'From shared Part',
  evidence_group: 'From evidence group',
  conflict: 'Groups disagree',
  unconfirmed: 'Groups unconfirmed',
}

type MediaGroups = Pick<MediaSnapshotDto, 'evidence' | 'groups'>

/**
 * The lot's effective location and where it came from: lot, shared Part, evidence group or
 * batch default. Without a media read, group membership is unknown rather than empty.
 */
export function lotLocationFact(
  batch: CaptureSnapshotDto,
  lot: CaptureSnapshotDto['lots'][number],
  media: MediaGroups | undefined,
): { value: string; provenance: Provenance } {
  const resolution = resolveLotLocation(
    batch,
    lot,
    media ? lotLocationGroups(media.evidence) : null,
  )

  const groupLabels = (ids: readonly string[]) =>
    ids
      .map((id) => media?.groups.find((group) => group.id === id)?.label ?? 'Evidence group')
      .join(', ')

  if (resolution.status === 'conflict') {
    return {
      value: `Evidence groups assign different locations: ${groupLabels(resolution.group_ids)}`,
      provenance: 'conflict',
    }
  }
  if (resolution.status === 'groups_unavailable') {
    return { value: 'Evidence group locations could not be confirmed', provenance: 'unconfirmed' }
  }
  const value = display(resolution.location, batch, 'location')
  switch (resolution.source) {
    case 'part':
      return { value, provenance: 'shared_part' }
    case 'group':
      return {
        value: `${value} · ${groupLabels(resolution.group_ids)}`,
        provenance: 'evidence_group',
      }
    case 'batch': {
      const draft = resolution.location.mode === 'unset' ? locationDraftName(batch) : null
      return {
        value: draft
          ? `New location ${draft} · created only after approval`
          : display(lot.location, batch, 'location'),
        provenance: 'inherited',
      }
    }
    default:
      return { value, provenance: lotProvenance(lot.location, batch.defaults.location) }
  }
}

type Selection = CaptureSnapshotDto['lots'][number]['quantity' | 'location']

/** An explicit lot value overriding a set batch default is an override, not just human input. */
export function lotProvenance(
  value: Selection,
  defaultValue: CaptureSnapshotDto['defaults']['quantity' | 'location'],
): Provenance {
  if (value.mode === 'inherit') {
    return 'inherited'
  }
  if (value.mode === 'unknown') {
    return 'unknown'
  }
  if (value.mode === 'clear') {
    return 'cleared'
  }
  if (value.mode === 'unset') {
    return 'unset'
  }
  return defaultValue.mode === 'set' ? 'override' : 'human'
}

export function partProvenance(choice: CaptureSnapshotDto['parts'][number]['choice']): Provenance {
  switch (choice.mode) {
    case 'set':
    case 'create':
      return 'human'
    case 'unknown':
      return 'unknown'
    case 'clear':
      return 'cleared'
    case 'unset':
      return 'unset'
  }
}

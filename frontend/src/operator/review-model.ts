import type {
  CaptureSnapshotDto,
  OperatorIssueDto,
  OperatorLotDto,
  OperatorReviewDto,
} from '@invimport/contracts'

export const REVIEW_FILTERS = [
  'all',
  'needs_review',
  'blocking',
  'warnings',
  'changed',
  'reviewed',
  'retired',
] as const

export type ReviewFilter = (typeof REVIEW_FILTERS)[number]
export type ReviewView = 'evidence' | 'table'

export const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: 'All',
  needs_review: 'Needs review',
  blocking: 'Blocking',
  warnings: 'Warnings',
  changed: 'Changed after review',
  reviewed: 'Reviewed',
  retired: 'Retired',
}

export interface ReviewLocation {
  lotId: string | null
  view: ReviewView
  filter: ReviewFilter
}

/** Review URLs: `#<batch>/review[/<lot>][?view=table&filter=warnings]`. */
export function parseReviewLocation(hash: string): ReviewLocation {
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query)
  const segments = path.split('/')
  const filter = params.get('filter')
  return {
    lotId: segments[1] === 'review' && segments[2] ? segments[2] : null,
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
  const lot = value.lotId ? `/${value.lotId}` : ''
  return `#${batchId}/review${lot}${query ? `?${query}` : ''}`
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

export function matchesFilter(lot: OperatorLotDto, filter: ReviewFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'needs_review':
      return lot.review_state !== 'reviewed' && !lot.approved
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
  'blocking' | 'warnings' | 'changed' | 'needs_review' | 'reviewed' | 'approved'

export const GROUP_LABELS: Record<QueueGroup, string> = {
  blocking: 'Blocking',
  warnings: 'Warnings to resolve',
  changed: 'Changed after review',
  needs_review: 'Needs review',
  reviewed: 'Reviewed',
  approved: 'Already approved',
}

/** One queue group per lot, most urgent first. */
export function queueGroup(lot: OperatorLotDto): QueueGroup {
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
]

export function retiredLotIds(review: OperatorReviewDto | undefined): ReadonlySet<string> {
  return new Set(review?.retired_lots.map((lot) => lot.lot_id) ?? [])
}

export type Provenance = 'human' | 'inherited' | 'override' | 'unknown' | 'cleared' | 'unset'

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  human: 'Human set',
  inherited: 'Inherited default',
  override: 'Override',
  unknown: 'Unknown',
  cleared: 'Cleared',
  unset: 'Unset',
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
      return 'human'
    case 'unknown':
      return 'unknown'
    case 'clear':
      return 'cleared'
    case 'unset':
      return 'unset'
  }
}

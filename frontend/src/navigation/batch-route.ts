export type BatchTab = 'capture' | 'processing' | 'review' | 'changes'

export type ProcessingStep = 'overview' | 'examine' | 'research' | 'images' | 'inventory'

export type BatchRoute =
  | { tab: 'capture' }
  | { tab: 'processing'; step: ProcessingStep; questionId?: string }
  | { tab: 'review'; view: 'lots'; lotId?: string }
  | { tab: 'review'; view: 'map' }
  | { tab: 'review'; view: 'records'; recordType?: string; recordId?: string }
  | { tab: 'changes'; view: 'ready'; preparationId?: string }
  | { tab: 'changes'; view: 'added'; runId?: string }

export type ParsedBatchRoute =
  | {
      kind: 'route'
      batchId: string
      route: BatchRoute
      /** The query string including its `?`, or empty. */
      query: string
      /** A former `#<batch>/<subject>` link, which the batch resolves once loaded. */
      legacySubject?: string
    }
  | { kind: 'redirect'; to: string }

const PROCESSING_STEPS: readonly ProcessingStep[] = [
  'overview',
  'examine',
  'research',
  'images',
  'inventory',
]

/** Reading and Identifying became the Examine step. */
const LEGACY_EXAMINE_STEPS = new Set(['reading', 'identifying'])

const REVIEW_VIEWS = new Set(['lots', 'map', 'records'])

function split(hash: string) {
  const trimmed = hash.replace(/^#/, '')
  const queryStart = trimmed.indexOf('?')
  const path = queryStart === -1 ? trimmed : trimmed.slice(0, queryStart)
  const query = queryStart === -1 ? '' : trimmed.slice(queryStart)

  return { segments: path.split('/').filter(Boolean), query }
}

function join(segments: (string | undefined)[], query = '') {
  return `${segments.filter((segment) => segment !== undefined).join('/')}${query}`
}

/** Old links that now live elsewhere; the query string always travels with them. */
function legacyRedirect(segments: string[], query: string): string | null {
  const [batchId, tab, first] = segments
  // Whatever followed the old step, lot, preparation or run carries over unchanged.
  const rest = segments.slice(3)

  if (tab === 'approve') {
    return join([batchId, 'changes', 'ready', first, ...rest], query)
  }
  if (tab === 'results') {
    return join([batchId, 'changes', 'added', first, ...rest], query)
  }
  if (tab === 'review' && !first) {
    return join([batchId, 'review', 'lots'], query)
  }
  if (tab === 'review' && !REVIEW_VIEWS.has(first)) {
    return join([batchId, 'review', 'lots', first, ...rest], query)
  }
  if (tab === 'processing' && !first) {
    return join([batchId, 'processing', 'overview'], query)
  }
  if (tab === 'processing' && LEGACY_EXAMINE_STEPS.has(first)) {
    return join([batchId, 'processing', 'examine', ...rest], query)
  }

  return null
}

function processingRoute(first?: string, second?: string): BatchRoute {
  const step = PROCESSING_STEPS.includes(first as ProcessingStep)
    ? (first as ProcessingStep)
    : 'overview'

  return second ? { tab: 'processing', step, questionId: second } : { tab: 'processing', step }
}

/** Record ids are encoded in the hash, since a tag record's id can hold any character. */
function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function reviewRoute(first?: string, second?: string, third?: string): BatchRoute {
  if (first === 'map') {
    return { tab: 'review', view: 'map' }
  }
  if (first === 'records') {
    return {
      tab: 'review',
      view: 'records',
      ...(second ? { recordType: second } : {}),
      ...(third ? { recordId: decodeSegment(third) } : {}),
    }
  }

  return second ? { tab: 'review', view: 'lots', lotId: second } : { tab: 'review', view: 'lots' }
}

function changesRoute(first?: string, second?: string): BatchRoute {
  if (first === 'added') {
    return second
      ? { tab: 'changes', view: 'added', runId: second }
      : { tab: 'changes', view: 'added' }
  }

  return second
    ? { tab: 'changes', view: 'ready', preparationId: second }
    : { tab: 'changes', view: 'ready' }
}

/** Parses a batch hash, or names the route an old link now redirects to. */
export function parseBatchRoute(hash: string): ParsedBatchRoute {
  const { segments, query } = split(hash)
  const redirect = legacyRedirect(segments, query)
  if (redirect !== null) {
    return { kind: 'redirect', to: redirect }
  }
  const [batchId, tab, first, second, third] = segments

  switch (tab) {
    case 'processing':
      return { kind: 'route', batchId, route: processingRoute(first, second), query }
    case 'review':
      return { kind: 'route', batchId, route: reviewRoute(first, second, third), query }
    case 'changes':
      return { kind: 'route', batchId, route: changesRoute(first, second), query }
    case undefined:
    case 'capture':
      return { kind: 'route', batchId, route: { tab: 'capture' }, query }
    default:
      return { kind: 'route', batchId, route: { tab: 'capture' }, query, legacySubject: tab }
  }
}

function routeSegments(route: BatchRoute): (string | undefined)[] {
  switch (route.tab) {
    case 'capture':
      return ['capture']
    case 'processing':
      return ['processing', route.step, route.questionId]
    case 'review':
      if (route.view === 'lots') {
        return ['review', 'lots', route.lotId]
      }
      if (route.view === 'records') {
        return [
          'review',
          'records',
          route.recordType,
          route.recordId === undefined ? undefined : encodeURIComponent(route.recordId),
        ]
      }
      return ['review', 'map']
    case 'changes':
      return route.view === 'ready'
        ? ['changes', 'ready', route.preparationId]
        : ['changes', 'added', route.runId]
  }
}

/** The hash for a route, without its leading `#`. */
export function batchRouteHash(batchId: string, route: BatchRoute, query = '') {
  return join([batchId, ...routeSegments(route)], query)
}

/** A link to a batch route. */
export function batchHref(batchId: string, route: BatchRoute, query = '') {
  return `#${batchRouteHash(batchId, route, query)}`
}

/** The Processing step that shows a job of the given stage. */
export function processingStepFor(stage: string): ProcessingStep {
  if (LEGACY_EXAMINE_STEPS.has(stage)) {
    return 'examine'
  }

  return PROCESSING_STEPS.includes(stage as ProcessingStep) ? (stage as ProcessingStep) : 'overview'
}

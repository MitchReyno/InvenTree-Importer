import { appPage, routeBatchId } from './app-route'
import { parseBatchRoute, type BatchTab } from './batch-route'

const STATE_KEY = 'settingsReturnTo'

const TAB_LABEL: Record<BatchTab, string> = {
  capture: 'Capture',
  processing: 'Processing',
  review: 'Review',
  changes: 'Changes',
}

/** The route Settings returns to, as stored in a history entry's state. */
export function storedSettingsReturn(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !(STATE_KEY in state)) {
    return undefined
  }
  const value = (state as Record<string, unknown>)[STATE_KEY]

  return typeof value === 'string' ? value : undefined
}

/** Keeps the return route in the current history entry, so reload and Back restore it. */
export function storeSettingsReturn(returnTo: string) {
  const state = typeof history.state === 'object' && history.state !== null ? history.state : {}
  history.replaceState({ ...state, [STATE_KEY]: returnTo }, '')
}

/**
 * The route Settings returns to after moving from `previous` to `next`: the screen Settings was
 * opened from, kept while moving between its sections, and none outside Settings.
 */
export function settingsReturnAfter(
  previous: string,
  next: string,
  previousReturn: string | undefined,
) {
  if (appPage(next) !== 'settings') {
    return undefined
  }

  return appPage(previous) === 'settings' ? previousReturn : previous
}

function batchTab(route: string): BatchTab {
  const parsed = parseBatchRoute(route)
  const settled = parsed.kind === 'redirect' ? parseBatchRoute(parsed.to) : parsed

  return settled.kind === 'route' ? settled.route.tab : 'capture'
}

/** The back link's target and the screen it names; Batches when Settings was loaded directly. */
export function settingsBack(returnTo: string | undefined, batchTitle: string | undefined) {
  if (returnTo === 'agents') {
    return { label: 'Agents', href: '#agents' }
  }
  if (!returnTo || !routeBatchId(returnTo)) {
    return { label: 'Batches', href: '#' }
  }

  return {
    label: `${batchTitle ?? 'the batch'} › ${TAB_LABEL[batchTab(returnTo)]}`,
    href: `#${returnTo}`,
  }
}

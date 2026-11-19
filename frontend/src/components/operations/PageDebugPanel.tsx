import { DebugPanel, type DebugRow } from '#/components/ui'
import { useServerScope, useUpdateHealth, type UpdateHealth } from '#/context'
import { useDebugReads, type DebugRead } from '#/debug/useDebugReads'
import { useCachedBatchReads } from '#/header/useCachedBatchReads'
import { serverQueryKey } from '#/queries/scope'
import { useCachedData } from '#/queries/useCachedData'

type PageDebugPanelProps = {
  /** The hash route without `#`; empty for Batches. */
  route: string
  batchId: string | undefined
}

function screenName(route: string, batchId: string | undefined) {
  if (!route) {
    return 'Batches'
  }
  if (batchId) {
    const [, tab, view] = route.split(/[/?]/)

    return [tab ?? 'capture', view].filter(Boolean).join(' › ')
  }

  return route.split(/[/?]/).join(' › ')
}

function age(at: number | null, now: number) {
  if (at === null) {
    return 'no data yet'
  }

  return `${Math.max(0, Math.round((now - at) / 1000))} s old`
}

function readState(read: DebugRead, now: number) {
  if (read.status === 'error') {
    return `failed · data ${age(read.dataUpdatedAt, now)}`
  }
  if (read.paused) {
    return `paused · data ${age(read.dataUpdatedAt, now)}`
  }
  if (read.fetching) {
    return `reading · data ${age(read.dataUpdatedAt, now)}`
  }

  return read.status === 'pending' ? 'not read yet' : age(read.dataUpdatedAt, now)
}

function liveUpdates(health: UpdateHealth, now: number) {
  const last =
    health.observedAt === null ? 'no frame yet' : `last frame ${age(health.observedAt, now)}`

  return `${health.state} · ${last}${health.truncated ? ' · stream truncated' : ''}`
}

/**
 * The page's Debug panel: route, batch identity, settings revision, live updates and each mounted
 * read. Every hook here only reads state the page already holds; `App` mounts it in debug mode.
 */
export function PageDebugPanel({ route, batchId }: PageDebugPanelProps) {
  const scope = useServerScope()
  const health = useUpdateHealth()
  const reads = useDebugReads()
  const batch = useCachedBatchReads(batchId)
  const agentSettings = useCachedData<{ revision: string }>(serverQueryKey(scope, 'agent-settings'))
  const now = Date.now()
  const rows: DebugRow[] = [
    { label: 'Route', value: `#${route}` },
    ...(batchId ? [{ label: 'Batch', value: batchId }] : []),
    ...(batch.revision ? [{ label: 'Batch revision', value: batch.revision }] : []),
    ...(agentSettings ? [{ label: 'Agent settings revision', value: agentSettings.revision }] : []),
    { label: 'Live updates', value: liveUpdates(health, now) },
    ...reads.map((read) => ({ label: read.name, value: readState(read, now) })),
  ]

  return <DebugPanel screen={screenName(route, batchId)} rows={rows} />
}

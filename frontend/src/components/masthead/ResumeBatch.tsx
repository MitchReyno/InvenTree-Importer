import { useCallback, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { Button, Small } from '#/components/ui'
import { useApiClients, useServerScope } from '#/context'
import { useAsyncAction } from '#/lifecycle/useAsyncAction'
import { freshReads } from '#/queries/fresh-reads'
import { serverQueryKey } from '#/queries/scope'

type Props = {
  batchId: string
  /** Why Resume can't be sent now, such as a stale work read; Resume is then disabled. */
  unavailable?: string
}

/**
 * Whether every header work read in scope holds a result whose request started after the last
 * live hint, with none in flight, so a newer pause made elsewhere would already show.
 */
function workReadSettled(queryClient: QueryClient, key: QueryKey) {
  const registry = freshReads(queryClient)
  const reads = queryClient.getQueryCache().findAll({ queryKey: key })
  return (
    reads.length > 0 &&
    reads.every(
      (read) =>
        read.state.status === 'success' &&
        read.state.fetchStatus !== 'paused' &&
        // Any tracked request verifies it, so the order to compare from is the start.
        registry.settledAfterHint(read.queryKey, 0),
    )
  )
}

/**
 * Resume for a paused batch, through the existing pause route; the header's only command besides
 * the connection check. The shown state changes only once the reads come back.
 */
export function ResumeBatch({ batchId, unavailable }: Props) {
  const { agents } = useApiClients()
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const { busy, error, run } = useAsyncAction()
  const pause = agents?.pause
  const workKey = serverQueryKey(scope, 'header-work')
  const subscribe = useCallback(
    (notify: () => void) => {
      const stopCache = queryClient.getQueryCache().subscribe(notify)
      const stopHints = freshReads(queryClient).subscribe(notify)
      return () => {
        stopCache()
        stopHints()
      }
    },
    [queryClient],
  )
  const settled = useSyncExternalStore(subscribe, () => workReadSettled(queryClient, workKey))
  const reason = unavailable ?? (pause ? undefined : 'Resume is not available in this setup.')

  async function resume() {
    try {
      await pause!(batchId, false)
    } finally {
      // Whether or not the reply arrived, the server may have resumed; the reads say which.
      await Promise.all(
        (['header-work', 'processing', 'agent-sessions', 'attention'] as const).map((resource) =>
          queryClient.invalidateQueries({ queryKey: serverQueryKey(scope, resource) }),
        ),
      )
    }
  }

  function handleResume() {
    // A hint since this render may mean a newer pause; nothing is sent until the read lands.
    if (!workReadSettled(queryClient, workKey)) {
      return
    }
    void run(
      resume,
      "Resume wasn't confirmed; the batch shows as paused until the next read says otherwise.",
    )
  }

  if (reason) {
    return (
      <Control>
        <Button size="sm" disabled>
          Resume
        </Button>
        <Small>{reason}</Small>
      </Control>
    )
  }

  return (
    <Control>
      <Button
        size="sm"
        disabled={busy}
        reasonDisplay="quiet"
        disabledReason={settled ? undefined : 'Updating…'}
        onClick={handleResume}
      >
        Resume
      </Button>
      {error && <Failed role="alert">{error}</Failed>}
    </Control>
  )
}

const Control = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
`

const Failed = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.bad};
`

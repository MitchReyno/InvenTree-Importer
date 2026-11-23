import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { Button, Small } from '#/components/ui'
import { useApiClients, useServerScope } from '#/context'
import { useAsyncAction } from '#/lifecycle/useAsyncAction'
import { readAfterHint, useReadAfterHint } from '#/queries/useReadAfterHint'
import { serverQueryKey } from '#/queries/scope'

type Props = {
  batchId: string
  /** The header work read the popover shows; Resume waits until it started after the last hint. */
  readKey: QueryKey
  /** Why Resume can't be sent now, such as a stale work read; Resume is then disabled. */
  unavailable?: string
}

/**
 * Resume for a paused batch, through the existing pause route; the header's only command besides
 * the connection check. The shown state changes only once the reads come back.
 */
export function ResumeBatch({ batchId, readKey, unavailable }: Props) {
  const { agents } = useApiClients()
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const { busy, error, run } = useAsyncAction()
  const pause = agents?.pause
  // A newer pause made elsewhere shows only in a read that started after the last live hint.
  const settled = useReadAfterHint(readKey, 'settled')
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
    if (!readAfterHint(queryClient, readKey, 'settled')) {
      return
    }
    void run(
      resume,
      "Resume wasn't confirmed; the batch shows as paused until the next read says otherwise.",
    )
  }

  if (reason) {
    // An unconfirmed Resume stays said even once a failed read makes Resume unavailable.
    return (
      <Control>
        <Button size="sm" disabled>
          Resume
        </Button>
        <Small>{reason}</Small>
        {error && <Failed role="alert">{error}</Failed>}
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

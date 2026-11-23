import { useQueryClient } from '@tanstack/react-query'
import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { Button, Small } from '#/components/ui'
import { useApiClients, useServerScope } from '#/context'
import { useAsyncAction } from '#/lifecycle/useAsyncAction'
import { serverQueryKey } from '#/queries/scope'

type Props = {
  batchId: string
  /** Why Resume can't be sent now, such as a stale work read; Resume is then disabled. */
  unavailable?: string
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
  const reason = unavailable ?? (pause ? undefined : 'Resume is not available in this setup.')

  async function resume() {
    await pause!(batchId, false)
    await Promise.all(
      (['header-work', 'processing', 'agent-sessions', 'attention'] as const).map((resource) =>
        queryClient.invalidateQueries({ queryKey: serverQueryKey(scope, resource) }),
      ),
    )
  }

  return (
    <Control>
      <Button
        size="sm"
        disabled={busy || reason !== undefined}
        onClick={() => void run(resume, 'Resuming failed; the agents are still paused.')}
      >
        Resume
      </Button>
      {reason && <Small>{reason}</Small>}
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

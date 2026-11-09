import { useQueryClient } from '@tanstack/react-query'
import type { AgentSessionListDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { Button } from '#/components/ui'
import { PauseButton } from './PauseButton'

type Props = {
  /** Pauses or resumes every batch's sessions; absent where this setup cannot. */
  pauseAll?: (paused: boolean) => Promise<unknown>
  /** The agent sessions list, which says which batches are paused. */
  list: AgentSessionListDto | undefined
}

/** True while any batch is paused, from the list's paused batches or its session rows. */
function somePaused(list: AgentSessionListDto | undefined) {
  if (!list) {
    return false
  }
  // The account list is bounded; each session row says its own batch's pause, so both count.
  const paused = (list.paused_batch_ids?.length ?? 0) > 0 || list.sessions.some((row) => row.paused)

  return paused || list.paused_truncated === true
}

/**
 * Pause all agents, with Resume all agents beside it while any batch is paused, since some can be
 * paused while others run. The shown state follows the next read of the sessions list.
 */
export function PauseAllAgents({ pauseAll, list }: Props) {
  const scope = useServerScope()
  const queryClient = useQueryClient()

  if (!pauseAll) {
    return (
      <Button size="sm" disabledReason="Pausing is not available for this setup.">
        Pause all agents
      </Button>
    )
  }

  const pause = pauseAll

  async function change(paused: boolean) {
    await pause(paused)
    await queryClient.invalidateQueries({ queryKey: serverQueryKey(scope, 'agent-sessions') })
  }

  return (
    <>
      <PauseButton paused={false} change={change} pauseLabel="Pause all agents" />
      {somePaused(list) && <PauseButton paused change={change} resumeLabel="Resume all agents" />}
    </>
  )
}

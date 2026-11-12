import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { Button } from '#/components/ui'
import { useAsyncAction } from '#/lifecycle/useAsyncAction'

type Props = {
  paused: boolean
  /**
   * Pauses (true) or resumes (false), then reads the sessions again; it rejects when the server
   * did not take the change.
   */
  change: (paused: boolean) => Promise<unknown>
  pauseLabel?: string
  resumeLabel?: string
}

/**
 * Pause all or Resume for agent sessions. Pausing cancels nothing; the shown state changes only
 * once the session list is read again, so a failed change leaves the previous state shown.
 */
export function PauseButton({
  paused,
  change,
  pauseLabel = 'Pause all',
  resumeLabel = 'Resume',
}: Props) {
  const { busy, error, run } = useAsyncAction()

  return (
    <Control>
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(
            () => change(!paused),
            paused
              ? 'Resuming failed; the agents are still paused.'
              : 'Pausing failed; the agents are still running.',
          )
        }
      >
        {paused ? resumeLabel : pauseLabel}
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

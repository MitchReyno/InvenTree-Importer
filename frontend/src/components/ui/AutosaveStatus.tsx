import styled from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { Button } from './primitives'

export type AutosaveState =
  | 'saved'
  | 'pending'
  | 'saving'
  | 'invalid'
  | 'rejected'
  | 'conflict'
  | 'unconfirmed'
  | 'disconnected'

type Props = {
  label: string
  state: AutosaveState
  revision: string
  onRetry?: () => void
  onReload?: () => void
}

const text: Record<AutosaveState, (revision: string) => string> = {
  saved: (revision) => `Saved · revision ${revision}`,
  pending: () => 'Unsaved changes · saving shortly',
  saving: () => 'Saving…',
  invalid: () => 'Not saved · fix the highlighted fields',
  rejected: () => 'Not saved · the server refused these values. Change them to try again.',
  disconnected: () => 'Not saved · connection unavailable; edits stay on this page',
  conflict: () => 'Not saved · another change was saved first. Your edits are kept here.',
  unconfirmed: () => 'Save not confirmed · it may or may not have been applied.',
}

/** Textual save state; recovery actions appear only where a human decision is needed. */
export function AutosaveStatus({ label, state, revision, onRetry, onReload }: Props) {
  const message = `${label}: ${text[state](revision)}`
  if (state === 'conflict' || state === 'unconfirmed') {
    return (
      <Problem role="alert" data-state={state}>
        <span>{message}</span>
        {state === 'unconfirmed' && onRetry && (
          <Button type="button" onClick={onRetry}>
            Retry the same save
          </Button>
        )}
        {onReload && (
          <Button type="button" onClick={onReload}>
            Discard my edits and load saved values
          </Button>
        )}
      </Problem>
    )
  }
  return (
    <Status role="status" data-state={state}>
      {message}
    </Status>
  )
}

const dotTone: Record<AutosaveState, string> = {
  saved: color.ok,
  pending: color.accent,
  saving: color.accent,
  invalid: color.warn,
  rejected: color.warn,
  unconfirmed: color.warn,
  disconnected: color.warn,
  conflict: color.bad,
}

const Status = styled.p<{ 'data-state': AutosaveState }>`
  display: inline-flex;
  align-items: center;
  gap: ${space['1-5']};
  margin: 0;
  font-size: 12.5px;
  color: ${color.muted};
  &::before {
    content: '';
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${(props) => dotTone[props['data-state']]};
  }
  &[data-state='invalid'],
  &[data-state='rejected'],
  &[data-state='disconnected'] {
    color: ${color.warn};
  }
`

const Problem = styled.div<{ 'data-state': 'conflict' | 'unconfirmed' }>`
  display: grid;
  gap: ${space[2]};
  padding: ${space['2-5']} ${space[3]};
  border: 1px solid ${(props) => (props['data-state'] === 'conflict' ? color.bad : color.warn)};
  border-radius: ${radius.input};
  background: ${(props) => (props['data-state'] === 'conflict' ? color.badWeak : color.warnWeak)};
  color: ${(props) => (props['data-state'] === 'conflict' ? color.bad : color.warn)};
  font-size: 12.5px;
  ${Button} {
    justify-self: start;
    color: ${color.fg};
  }
`

import styled from 'styled-components'
import { Button } from './primitives'

export type AutosaveState =
  'saved' | 'pending' | 'saving' | 'invalid' | 'conflict' | 'unconfirmed' | 'disconnected'

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
  disconnected: () => 'Not saved · connection unavailable; edits stay on this page',
  conflict: () => 'Not saved · another change was saved first. Your edits are kept here.',
  unconfirmed: () => 'Save not confirmed · it may or may not have been applied.',
}

/** Textual save state; recovery actions appear only where a human decision is needed. */
export function AutosaveStatus({ label, state, revision, onRetry, onReload }: Props) {
  const message = `${label}: ${text[state](revision)}`
  if (state === 'conflict' || state === 'unconfirmed') {
    return (
      <Problem role="alert">
        <span>{message}</span>
        {state === 'unconfirmed' && onRetry && (
          <Button type="button" onClick={onRetry}>
            Retry the same save
          </Button>
        )}
        {onReload && (
          <Button type="button" onClick={onReload}>
            {state === 'conflict' ? 'Discard my edits and load saved values' : 'Check saved values'}
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

const Status = styled.p`
  margin: 0;
  font-size: 13px;
  color: #526179;
  &[data-state='invalid'],
  &[data-state='disconnected'] {
    color: #8a4b00;
  }
`
const Problem = styled.div`
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #cd8585;
  border-radius: 6px;
  background: #fff0f0;
  font-size: 14px;
  ${Button} {
    justify-self: start;
  }
`

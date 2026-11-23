import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { Button } from './Button'

export type AutosaveState =
  | 'saved'
  | 'pending'
  | 'saving'
  | 'invalid'
  | 'rejected'
  | 'conflict'
  | 'unconfirmed'
  /** The server can't tell whether the save applied, so only a Reload resolves it. */
  | 'unresolved'
  | 'disconnected'

type Props = {
  label: string
  state: AutosaveState
  revision: string
  /** The owner's own wording for some states, in place of the defaults. */
  messages?: Partial<Record<AutosaveState, string>>
  /** The retry button's words; its accessible name always contains them. */
  retryLabel?: keyof typeof RETRY_NAME
  onRetry?: () => void
  onReload?: () => void
}

const text: Record<AutosaveState, (revision: string) => string> = {
  saved: () => 'Saved',
  pending: () => 'Unsaved changes · saving shortly',
  saving: () => 'Saving…',
  invalid: () => 'Not saved · fix the highlighted fields',
  rejected: () => 'Not saved · the server refused these values. Change them to try again.',
  disconnected: () => 'Not saved · connection unavailable; edits stay on this page',
  conflict: () => 'Not saved · another change was saved first. Your edits are kept here.',
  unconfirmed: () => 'Save not confirmed · it may or may not have been applied.',
  unresolved: () => 'Couldn’t confirm this change',
}

/** States that need a decision, so they are announced as alerts with their actions. */
const RECOVERY: ReadonlySet<AutosaveState> = new Set(['conflict', 'unconfirmed', 'unresolved'])
const RETRY_NAME = {
  Retry: 'Retry the same save',
  'Try again': 'Try the same save again',
}

/** States where sending the same save again is safe and useful. */
const RETRY: ReadonlySet<AutosaveState> = new Set(['conflict', 'unconfirmed'])

/** Textual save state; recovery actions appear only where a human decision is needed. */
export function AutosaveStatus({
  label,
  state,
  revision,
  messages,
  retryLabel = 'Retry',
  onRetry,
  onReload,
}: Props) {
  const message = `${label}: ${messages?.[state] ?? text[state](revision)}`
  if (RECOVERY.has(state)) {
    return (
      <Status role="alert" data-state={state}>
        <Message>
          {message}
          {RETRY.has(state) && onRetry && (
            <Button type="button" size="sm" onClick={onRetry} aria-label={RETRY_NAME[retryLabel]}>
              {retryLabel}
            </Button>
          )}
          {onReload && (
            <Button
              type="button"
              size="sm"
              onClick={onReload}
              aria-label="Reload saved values and discard my edits"
            >
              Reload
            </Button>
          )}
        </Message>
      </Status>
    )
  }
  return (
    <Status role="status" data-state={state} data-revision={revision}>
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
  unresolved: color.warn,
  disconnected: color.warn,
  conflict: color.bad,
}

const Status = styled.p<{ 'data-state': AutosaveState }>`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  &::before {
    content: '';
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: ${radius.round};
    background: ${(props) => dotTone[props['data-state']]};
  }
  &[data-state='invalid'],
  &[data-state='rejected'],
  &[data-state='disconnected'],
  &[data-state='unconfirmed'],
  &[data-state='unresolved'] {
    color: ${color.warn};
  }
  &[data-state='conflict'] {
    color: ${color.bad};
  }
`

/** Text and recovery buttons share one line that wraps as prose, as in the design system. */
const Message = styled.span`
  min-width: 0;
  button {
    margin-left: ${space[3]};
  }
`

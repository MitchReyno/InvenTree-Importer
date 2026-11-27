import styled from 'styled-components'
import { EventTime, Small, WORK_STATE } from '#/components/ui'
import { workState } from '#/header/workSegments'
import {
  earlierAttemptsLabel,
  failureHeadline,
  NEEDS_RECOVERY,
  type EarlierAttempt,
} from '#/agents/session-list'
import { color, space, typeVar } from '#/theme/generated/tokens'

type Props = {
  /** How many earlier attempts the session has, which may be more than `attempts` holds. */
  count: number
  /** Newest first; absent until read. */
  attempts?: readonly EarlierAttempt[]
  /** Why the attempts aren't shown yet. */
  status?: 'loading' | 'failed'
  /** Called when the list first opens, so a reader can load it then. */
  onOpen?: () => void
  /** "2 earlier failed", after a line that already names the current attempt. */
  brief?: boolean
}

/** Whether an attempt failed rather than ending some other way, such as a cancel. */
function failed(attempt: EarlierAttempt) {
  return Boolean(attempt.failure) || NEEDS_RECOVERY.has(attempt.sessionState ?? attempt.state)
}

function attemptText(attempt: EarlierAttempt) {
  if (failed(attempt)) {
    return failureHeadline(attempt.failure)
  }
  const own = attempt.sessionState ?? attempt.state
  // Replaced before it finished, so its own state says nothing about how it ended.
  if (attempt.state === 'superseded' && (own === 'queued' || own === 'superseded')) {
    return 'Replaced by a later attempt'
  }
  return WORK_STATE[workState(own)].word
}

/** "2 earlier attempts failed ▸", folding each earlier attempt's time and cause under a session. */
export function EarlierAttempts({ count, attempts, status, onOpen, brief = false }: Props) {
  if (count === 0) {
    return null
  }
  const complete = attempts !== undefined && attempts.length === count
  const allFailed = complete && attempts.every(failed)
  let label: string
  if (brief) {
    label = complete ? `${count} earlier ${allFailed ? 'failed' : 'ended'}` : `${count} earlier`
  } else {
    label = complete
      ? earlierAttemptsLabel(count, allFailed)
      : `${count} earlier attempt${count === 1 ? '' : 's'}`
  }

  return (
    <Fold
      onToggle={(event) => {
        if (event.currentTarget.open) {
          onOpen?.()
        }
      }}
    >
      <summary>{label}</summary>
      {status === 'loading' && <Small role="status">Loading earlier attempts…</Small>}
      {status === 'failed' && <Small role="alert">Earlier attempts couldn’t be loaded.</Small>}
      {attempts && attempts.length > 0 && (
        <Attempts>
          {attempts.map((attempt) => (
            <li key={attempt.id}>
              <span>Attempt {attempt.number}</span>
              <EventTime at={attempt.at} />
              <span>{attemptText(attempt)}</span>
            </li>
          ))}
        </Attempts>
      )}
      {attempts && attempts.length < count && (
        <Small>
          {count - attempts.length} older attempt{count - attempts.length === 1 ? '' : 's'} are on
          the session page.
        </Small>
      )}
    </Fold>
  )
}

const Fold = styled.details`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  summary {
    cursor: pointer;
    width: fit-content;
  }
`

const Attempts = styled.ol`
  display: grid;
  gap: ${space[2]};
  margin: ${space[2]} 0 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[1]} ${space[3]};
  }
`

import styled from 'styled-components'
import type { SessionHistoryAttemptDto } from '@invimport/contracts'
import {
  SessionFailureDetails,
  FAILED_SESSION_STATES,
  type FailureLoader,
} from '#/components/agents/SessionFailureDetails'
import { EventTime } from '#/components/ui'
import { color, space, typeVar } from '#/theme/generated/tokens'

/** How an attempt stands or ended, in words that say what happened to that attempt. */
const OUTCOME: Record<SessionHistoryAttemptDto['state'], string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_for_user: 'Waiting for you',
  waiting_for_login: 'Waiting for sign-in',
  waiting_for_capacity: 'Waiting for a slot',
  ready: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
  superseded: 'Replaced by a later attempt',
  interrupted: 'Interrupted',
}

const STARTED_BECAUSE = {
  first: 'first attempt',
  after_failure: 'after the previous attempt failed',
}

/** "Attempt N", with why it started only where the retained data records it. */
function attemptTitle(attempt: SessionHistoryAttemptDto) {
  const reason = attempt.started_because ? STARTED_BECAUSE[attempt.started_because] : null
  return reason ? `Attempt ${attempt.number} · ${reason}` : `Attempt ${attempt.number}`
}

/** Where an attempt was queued in the conversation: how it ended, and its failure when it failed. */
export function AttemptDivider({
  attempt,
  loadFailure,
}: {
  attempt: SessionHistoryAttemptDto
  loadFailure?: FailureLoader
}) {
  const title = attemptTitle(attempt)
  const failed = attempt.failure || FAILED_SESSION_STATES.has(attempt.session_state ?? '')
  return (
    <Divider>
      <hr aria-label={title} />
      <span>
        {title} · queued <EventTime at={attempt.queued_at} />
      </span>
      <Outcome>
        {OUTCOME[attempt.state]}
        {attempt.ended && (
          <>
            {attempt.ended.source === 'transition' ? ' · ended ' : ' · last activity '}
            <EventTime at={attempt.ended.at} />
          </>
        )}
      </Outcome>
      {failed && (
        <SessionFailureDetails
          attemptId={attempt.id}
          failure={attempt.failure}
          load={loadFailure}
        />
      )}
    </Divider>
  )
}

const Outcome = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Divider = styled.div`
  display: grid;
  gap: ${space[2]};
  margin: ${space[4]} 0 ${space[2]};
  hr {
    margin: 0;
    border: 0;
    border-top: 1px solid ${color.lineStrong};
  }
  > span {
    font-size: ${typeVar.label.size};
    font-weight: ${typeVar.label.weight};
    letter-spacing: ${typeVar.label.letterSpacing};
    text-transform: uppercase;
    color: ${color.muted};
  }
`

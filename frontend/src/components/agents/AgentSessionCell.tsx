import { useState } from 'react'
import styled from 'styled-components'
import type { AgentSessionDto } from '@invimport/contracts'
import { batchHref, processingStepFor, sessionPageHref } from '#/navigation/batch-route'
import { Button, Link } from '#/components/ui'
import { earlierFromList, needsRecovery } from '#/agents/session-list'
import { startFreshReason } from '#/processing/start-fresh'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { EarlierAttempts } from './EarlierAttempts'
import { FailureSummary } from './FailureSummary'
import { SessionFailureDetails, type FailureLoader } from './SessionFailureDetails'
import type { BatchNames } from './AgentSessions'

/** Attempt states that have ended; a worker may still hold the slot of one. */
export const ENDED = new Set(['ready', 'failed', 'cancelled', 'superseded', 'interrupted'])

type RowProps = {
  session: AgentSessionDto
  title: string
  subject: string
  names: BatchNames | undefined
  loadFailure?: FailureLoader
}

/**
 * One session: its title opens the session page, then its latest status or failure, its earlier
 * attempts folded, and recovery when its current attempt failed.
 */
export function AgentSessionCell({ session, title, subject, names, loadFailure }: RowProps) {
  const [details, setDetails] = useState(false)
  const step = processingStepFor(session.stage)
  const href = sessionPageHref(session.batch_id, step, session.job_id)
  const failed = needsRecovery(session)
  // A retained failure shows whatever the row offers, a cancelled turn's included.
  const showFailure = failed || session.failure !== undefined
  // An earlier profile's attempt has no session history, so it has no page to open.
  const hasPage = session.session_state !== null
  const notes = [
    session.state === 'waiting_for_user' && 'holds no slot',
    session.occupies_lane &&
      ENDED.has(session.state) &&
      'still holds its slot until the command is confirmed stopped',
  ].filter(Boolean)
  const lotLive = session.subject_id !== null && names?.liveLots?.has(session.subject_id) === true
  const freshReason = startFreshReason(session.start_fresh)

  return (
    <Cell>
      {hasPage ? (
        <Link href={href} aria-label={`Open session: ${title}`}>
          {title}
        </Link>
      ) : (
        <strong>{title}</strong>
      )}
      {showFailure && details && (
        <SessionFailureDetails
          key={`${session.attempt_id}:${session.failure?.id ?? 'legacy'}`}
          attemptId={session.attempt_id}
          failure={session.failure}
          load={loadFailure}
        />
      )}
      {showFailure && !details && <FailureSummary failure={session.failure} />}
      {!showFailure && session.latest_status && <Status>{session.latest_status.text}</Status>}
      {notes.length > 0 && <Status>{notes.join(' · ')}</Status>}
      <EarlierAttempts count={session.earlier_attempt_count} attempts={earlierFromList(session)} />
      {failed && hasPage && (
        <Actions role="group" aria-label={`Recover ${title}`}>
          {freshReason ? (
            <Button size="sm" disabledReason={freshReason}>
              Start fresh
            </Button>
          ) : (
            // Start fresh needs the batch's current read, so it runs on the session page.
            <Button as="a" size="sm" href={href}>
              Start fresh
            </Button>
          )}
          <Link href={href}>Open session</Link>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={details}
            onClick={() => setDetails((open) => !open)}
          >
            Failure details
          </Button>
          {lotLive && (
            <Link
              href={batchHref(session.batch_id, {
                tab: 'review',
                view: 'lots',
                lotId: session.subject_id!,
              })}
              aria-label={`Open lot in Review: ${subject}`}
            >
              Open lot in Review
            </Link>
          )}
        </Actions>
      )}
    </Cell>
  )
}

const Cell = styled.div`
  display: grid;
  justify-items: start;
  gap: ${space[2]};
  min-width: 0;
`

const Status = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]} ${space[4]};
`

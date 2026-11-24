import { useState } from 'react'
import styled from 'styled-components'
import type { AgentSessionDto } from '@invimport/contracts'
import { batchHref, processingStepFor, sessionPageHref } from '#/navigation/batch-route'
import {
  Button,
  DataTable,
  EventTime,
  Link,
  StatePill,
  TableWrap,
  WORK_STATE,
  type WorkState,
} from '#/components/ui'
import { STEP_LABEL } from '#/components/processing/ProcessingParts'
import { workState } from '#/header/workSegments'
import { earlierFromList, needsRecovery } from '#/agents/session-list'
import { startFreshReason } from '#/processing/start-fresh'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { EarlierAttempts } from './EarlierAttempts'
import { FailureLine, SessionFailureDetails, type FailureLoader } from './SessionFailureDetails'
import type { BatchNames } from './AgentSessions'

const ENDED = new Set(['ready', 'failed', 'cancelled', 'superseded', 'interrupted'])

/** A session row's state word: its current attempt's own state, paused while its batch is. */
function rowState(session: AgentSessionDto): WorkState {
  // An ended attempt's own state is the outcome, even while its worker still holds the slot.
  if (ENDED.has(session.state)) {
    return workState(session.state)
  }
  if (session.paused && session.session_state !== 'finished') {
    return 'paused'
  }
  return workState(session.session_state ?? session.state)
}

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
function SessionCell({ session, title, subject, names, loadFailure }: RowProps) {
  const [details, setDetails] = useState(false)
  const step = processingStepFor(session.stage)
  const href = sessionPageHref(session.batch_id, step, session.job_id)
  const failed = needsRecovery(session)
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
      <Link href={href} aria-label={`Open session: ${title}`}>
        {title}
      </Link>
      {failed ? (
        <FailureLine failure={session.failure} />
      ) : (
        session.latest_status && <Status>{session.latest_status.text}</Status>
      )}
      {notes.length > 0 && <Status>{notes.join(' · ')}</Status>}
      <EarlierAttempts count={session.earlier_attempt_count} attempts={earlierFromList(session)} />
      {failed && (
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
      {failed && details && (
        <SessionFailureDetails
          key={`${session.attempt_id}:${session.failure?.id ?? 'legacy'}`}
          attemptId={session.attempt_id}
          failure={session.failure}
          load={loadFailure}
        />
      )}
    </Cell>
  )
}

const COLUMNS = [
  { id: 'session', header: 'Session' },
  { id: 'state', header: 'State', nowrap: true },
  { id: 'since', header: 'Since', mono: true, nowrap: true },
]

/** One batch's sessions, one row each. */
export function AgentSessionTable({
  caption,
  rows,
  names,
  loadFailure,
}: {
  caption: string
  rows: readonly AgentSessionDto[]
  names: BatchNames | undefined
  loadFailure?: FailureLoader
}) {
  return (
    <Table>
      <DataTable
        caption={caption}
        columns={COLUMNS}
        rows={rows.map((session) => {
          const subject =
            session.subject_id === null
              ? 'Whole batch'
              : (names?.subjects.get(session.subject_id) ?? 'Unknown subject')
          const title = `${STEP_LABEL[processingStepFor(session.stage)] ?? 'Processing'} · ${subject}`
          const state = rowState(session)
          return {
            id: session.job_id,
            label: title,
            cells: {
              session: {
                value: title,
                content: (
                  <SessionCell
                    session={session}
                    title={title}
                    subject={subject}
                    names={names}
                    loadFailure={loadFailure}
                  />
                ),
              },
              state: { value: WORK_STATE[state].word, content: <StatePill state={state} /> },
              since: {
                value: session.state_since,
                content: <EventTime at={session.state_since} />,
              },
            },
          }
        })}
      />
    </Table>
  )
}

const Table = styled.div`
  ${TableWrap} {
    border: 0;
    border-radius: 0;
  }
`

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

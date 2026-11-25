import styled from 'styled-components'
import type { SessionHistoryDto } from '@invimport/contracts'
import { EventTime, Link, StatePill } from '#/components/ui'
import { EarlierAttempts } from '#/components/agents/EarlierAttempts'
import { workState } from '#/header/workSegments'
import { modelName } from '#/processing/model-name'
import { attemptsOldestFirst, earlierAttemptsOf } from '#/processing/session-history'
import { color, space, typeVar } from '#/theme/generated/tokens'

type Metadata = SessionHistoryDto['session']
type Attempt = Metadata['attempts'][number]

const RUNS_ON = { agent_vm: 'agent VM', host: 'this computer', fixture: 'fixture' }

function webWords(attempt: Attempt) {
  if (attempt.web === null) {
    return 'no web'
  }
  return attempt.web.public_pages ? 'web on' : 'web off'
}

function modelWords(attempt: Attempt) {
  if (!attempt.selection) {
    return 'Deterministic fixture'
  }
  return modelName(attempt.actual_model ?? attempt.selection.model)
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/**
 * The drawer's header, from the session's history metadata, so a drawer opened from Processing
 * has it for any session: its state, model, where it ran, web, span and earlier attempts.
 */
export function SessionDrawerHeader({
  session,
  fullSession,
}: {
  session: Metadata
  fullSession: string
}) {
  const ordered = attemptsOldestFirst(session.attempts)
  const first = ordered[0]
  const current =
    session.attempts.find((attempt) => attempt.id === session.current_attempt_id) ??
    ordered[ordered.length - 1]
  const end = current.ended?.at
  // The attempts before the one shown; after a switch to a profile without sessions the shown
  // attempt is the newest retained one, which the job's current attempt doesn't name.
  const earlier = earlierAttemptsOf(session).filter((attempt) => attempt.number < current.number)

  return (
    <Header aria-label="Session details">
      <Facts>
        <StatePill state={workState(current.state)} />
        <span>
          {modelWords(current)} · {RUNS_ON[current.runs_on]} · {webWords(current)} ·{' '}
          <EventTime at={first.queued_at} />
          {end && (
            <>
              –<EventTime at={end} clockToday={sameDay(first.queued_at, end)} />
            </>
          )}
        </span>
      </Facts>
      <Attempts>
        {earlier.length > 0 && (
          <>
            <span>Attempt {current.number} ·</span>
            <EarlierAttempts count={earlier.length} attempts={earlier} brief />
          </>
        )}
        <Link href={fullSession}>Open full session</Link>
      </Attempts>
    </Header>
  )
}

const Header = styled.section`
  display: grid;
  gap: ${space[2]};
  min-width: 0;
`

const Facts = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
`

const Attempts = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[2]} ${space[3]};
  font-size: ${typeVar.small.size};
  > a {
    margin-left: auto;
  }
`

import { useState } from 'react'
import styled from 'styled-components'
import type { SourceSession } from '#/processing/source'
import {
  Button,
  hoverTransition,
  Link,
  linkTouchArea,
  media,
  Pill,
  StatePill,
} from '#/components/ui'
import { EarlierAttempts } from '#/components/agents/EarlierAttempts'
import { FailureSummary } from '#/components/agents/FailureSummary'
import {
  SessionFailureDetails,
  type FailureLoader,
} from '#/components/agents/SessionFailureDetails'
import { NEEDS_RECOVERY } from '#/agents/session-list'
import { workState } from '#/header/workSegments'
import { color, size, space, type, typeVar } from '#/theme/generated/tokens'
import { STEP_LABEL } from './ProcessingParts'

/** What a failed session's row offers to recover it. */
export type RowRecovery = {
  /** Absent where the batch's read has no such job to start again. */
  startFresh?: { run: () => void; reason?: string }
  /** The lot in Review, for a live lot's session. */
  lotHref?: string
  loadFailure?: FailureLoader
}

type Props = {
  session: SourceSession
  paused: boolean
  onOpen: (jobId: string) => void
  pageHref?: string
  recovery?: RowRecovery
}

/**
 * One session: the row opens its drawer; a failed one leads with its cause and offers Start
 * fresh, its full session, its failure details and its lot.
 */
export function SessionRowItem({ session, paused, onOpen, pageHref, recovery }: Props) {
  const [details, setDetails] = useState(false)
  const title = `${STEP_LABEL[session.step]} · ${session.subject}`
  const recoverable = NEEDS_RECOVERY.has(session.state)
  // A retained failure shows below the row; any other row shows its latest status line in it.
  const failed = recoverable || session.failure !== undefined
  const line = failed ? null : session.status

  return (
    <li>
      <SessionRow
        type="button"
        data-session-job={session.jobId}
        aria-label={`Open session: ${title}`}
        aria-describedby={`session-${session.jobId}-state${
          line ? ` session-${session.jobId}-status` : ''
        }`}
        onClick={() => onOpen(session.jobId)}
      >
        <SessionLabel>
          <Pill tone="neutral" glyph="">
            {STEP_LABEL[session.step]}
          </Pill>
          <b>{session.subject}</b>
        </SessionLabel>
        <span id={`session-${session.jobId}-state`}>
          <StatePill state={workState(session.state, { paused })} />
        </span>
        {line && <SessionStatus id={`session-${session.jobId}-status`}>{line}</SessionStatus>}
      </SessionRow>
      {pageHref && (
        <PageLink href={pageHref} aria-label={`Open full session: ${title}`}>
          Full session
        </PageLink>
      )}
      {failed && (
        <Below>
          {details && session.attemptId ? (
            <SessionFailureDetails
              key={`${session.attemptId}:${session.failure?.id ?? 'legacy'}`}
              attemptId={session.attemptId}
              failure={session.failure}
              load={recovery?.loadFailure}
            />
          ) : (
            <FailureSummary failure={session.failure} />
          )}
        </Below>
      )}
      {recoverable && recovery && (
        <Actions role="group" aria-label={`Recover ${title}`}>
          {recovery.startFresh && (
            <Button
              size="sm"
              disabledReason={recovery.startFresh.reason}
              onClick={recovery.startFresh.run}
            >
              Start fresh
            </Button>
          )}
          {session.attemptId && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={details}
              onClick={() => setDetails((open) => !open)}
            >
              Failure details
            </Button>
          )}
          {recovery.lotHref && (
            <Link href={recovery.lotHref} aria-label={`Open lot in Review: ${session.subject}`}>
              Open lot in Review
            </Link>
          )}
        </Actions>
      )}
      {session.earlier && (
        <Below>
          <EarlierAttempts count={session.earlier.count} attempts={session.earlier.attempts} />
        </Below>
      )}
    </li>
  )
}

const Below = styled.div`
  padding: 0 ${space[8]} ${space[4]};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]} ${space[4]};
  padding: 0 ${space[8]} ${space[4]};
`

const PageLink = styled.a`
  display: inline-block;
  margin: ${space[1]} 0 0 ${space[3]};
  font-size: ${typeVar.small.size};
  color: ${color.accent};
  ${linkTouchArea}
`

// The whole row opens the session drawer, as on the canvas.
const SessionRow = styled.button`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space[2]} ${space[5]};
  width: 100%;
  padding: ${space[5]} ${space[8]};
  border: 0;
  background: none;
  color: ${color.fg};
  font: inherit;
  text-align: left;
  cursor: pointer;
  ${hoverTransition}
  &:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const SessionLabel = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  min-width: 0;
  b {
    font-size: ${typeVar.small.size};
    overflow-wrap: anywhere;
  }
`

const SessionStatus = styled.span`
  grid-column: 1 / -1;
  ${type.small}
  color: ${color.muted};
`

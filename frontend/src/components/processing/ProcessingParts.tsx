import styled from 'styled-components'
import {
  Button,
  hoverTransition,
  linkTouchArea,
  media,
  Pill,
  raisedOnField,
  StatePill,
} from '#/components/ui'
import { EarlierAttempts } from '#/components/agents/EarlierAttempts'
import { failureHeadline, NEEDS_RECOVERY } from '#/agents/session-list'
import { workState } from '#/header/workSegments'
import { batchHref } from '#/navigation/batch-route'
import type { SourceQuestion, SourceSession } from '#/processing/source'
import { color, radius, size, space, type, typeVar } from '#/theme/generated/tokens'

export const STEP_LABEL: Record<string, string> = {
  examine: 'Examine',
  research: 'Research',
  images: 'Images',
  inventory: 'Inventory',
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

/** Load more for a session list read a page at a time. */
export type MoreSessions = {
  canLoadMore: boolean
  loadingMore: boolean
  moreFailed: boolean
  loadMore: () => void
}

export function SessionRows({
  sessions,
  paused = false,
  onOpen,
  pageHref,
  more,
}: {
  sessions: SourceSession[]
  /** The batch's agents are paused, so queued sessions read Paused. */
  paused?: boolean
  onOpen: (jobId: string) => void
  /** The session's full page; the row itself opens the drawer. */
  pageHref?: (session: SourceSession) => string
  more?: MoreSessions
}) {
  return (
    <>
      <SessionList>
        {sessions.map((session) => {
          // A failed session leads with its cause; any other with its latest status line.
          const line = NEEDS_RECOVERY.has(session.state)
            ? failureHeadline(session.failure)
            : session.status
          return (
            <li key={session.jobId}>
              <SessionRow
                type="button"
                data-session-job={session.jobId}
                aria-label={`Open session: ${STEP_LABEL[session.step]} · ${session.subject}`}
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
                {line && (
                  <SessionStatus id={`session-${session.jobId}-status`}>{line}</SessionStatus>
                )}
              </SessionRow>
              {pageHref && (
                <PageLink
                  href={pageHref(session)}
                  aria-label={`Open full session: ${STEP_LABEL[session.step]} · ${session.subject}`}
                >
                  Full session
                </PageLink>
              )}
              {session.earlier && (
                <Earlier>
                  <EarlierAttempts
                    count={session.earlier.count}
                    attempts={session.earlier.attempts}
                  />
                </Earlier>
              )}
            </li>
          )
        })}
      </SessionList>
      {more?.canLoadMore && (
        <Button size="sm" disabled={more.loadingMore} onClick={more.loadMore}>
          Load more
        </Button>
      )}
      {more?.moreFailed && <Muted role="alert">More sessions couldn’t be loaded.</Muted>}
    </>
  )
}

const Earlier = styled.div`
  padding: 0 ${space[8]} ${space[4]};
`

const PageLink = styled.a`
  display: inline-block;
  margin: ${space[1]} 0 0 ${space[3]};
  font-size: ${typeVar.small.size};
  color: ${color.accent};
  ${linkTouchArea}
`

export function QuestionRows({
  batchId,
  questions,
}: {
  batchId: string
  questions: SourceQuestion[]
}) {
  return (
    <Rows>
      {questions.map((question) => (
        <li key={question.id}>
          <span>
            <a
              href={batchHref(batchId, {
                tab: 'processing',
                step: question.step,
                questionId: question.id,
              })}
            >
              {question.title}
            </a>
            <Muted>
              {STEP_LABEL[question.step]} · {question.subject} · {question.kind}
              {question.assumption && ` · ${question.assumption}`}
            </Muted>
          </span>
          {question.lotId && (
            <a
              aria-label={`Open in Review: ${question.subject}`}
              href={batchHref(batchId, { tab: 'review', view: 'lots', lotId: question.lotId })}
            >
              Open in Review
            </a>
          )}
        </li>
      ))}
    </Rows>
  )
}

export const Card = styled.section`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
  /* Agent text, such as a question's prompt or assumption, can hold a long unbroken word. */
  overflow-wrap: anywhere;
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`

export const CardTitle = styled.h2`
  margin: 0;
  ${type.h2}
`

export const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[4]};
    padding: ${space[4]} 0;
    border-top: 1px solid ${color.line};
    overflow-wrap: anywhere;
  }
  li:first-child {
    border-top: 0;
  }
  li > :first-child {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  a {
    color: ${color.fg};
    font-weight: ${typeVar.bodyStrong.weight};
    ${linkTouchArea}
  }
`

const SessionList = styled.ul`
  display: grid;
  margin: 0 calc(-1 * ${space[8]});
  padding: 0;
  list-style: none;
  li {
    border-top: 1px solid ${color.line};
  }
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

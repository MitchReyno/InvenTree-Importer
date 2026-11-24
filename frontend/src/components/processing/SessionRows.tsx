import styled from 'styled-components'
import type { SourceSession } from '#/processing/source'
import { LoadMore, type MoreSessions } from '#/components/agents/LoadMore'
import { color, space } from '#/theme/generated/tokens'
import { SessionRowItem, type RowRecovery } from './SessionRowItem'

/** Processing's sessions, one row per session, each opening its drawer. */
export function SessionRows({
  sessions,
  paused = false,
  onOpen,
  pageHref,
  more,
  recovery,
}: {
  sessions: SourceSession[]
  /** The batch's agents are paused, so queued sessions read Paused. */
  paused?: boolean
  onOpen: (jobId: string) => void
  /** The session's full page; the row itself opens the drawer. */
  pageHref?: (session: SourceSession) => string
  more?: MoreSessions
  /** What a failed session's row offers to recover it. */
  recovery?: (session: SourceSession) => RowRecovery
}) {
  return (
    <>
      <SessionList>
        {sessions.map((session) => (
          <SessionRowItem
            key={session.jobId}
            session={session}
            paused={paused}
            onOpen={onOpen}
            pageHref={pageHref?.(session)}
            recovery={recovery?.(session)}
          />
        ))}
      </SessionList>
      {more && <LoadMore more={more} />}
    </>
  )
}

const SessionList = styled.ul`
  display: grid;
  margin: 0 calc(-1 * ${space[8]});
  padding: 0;
  list-style: none;
  li {
    border-top: 1px solid ${color.line};
  }
`

import { useId } from 'react'
import styled from 'styled-components'
import type { SessionHistoryDto } from '@invimport/contracts'
import { DebugDetails, EventTime, Link, StatePill } from '#/components/ui'
import { workState } from '#/header/workSegments'
import { attemptsOldestFirst } from '#/processing/session-history'
import { color, space, type, typeVar } from '#/theme/generated/tokens'

type Metadata = SessionHistoryDto['session']
type Attempt = Metadata['attempts'][number]

const PROVIDER = { claude: 'Claude', codex: 'Codex' }
const RUNS_ON = { agent_vm: 'in the agent VM', host: 'on this computer', fixture: 'as a fixture' }

function webWords(attempt: Attempt) {
  if (attempt.web === null) {
    return 'no web access'
  }
  return attempt.web.public_pages ? 'web pages allowed' : 'web pages off'
}

function modelWords(attempt: Attempt) {
  if (!attempt.selection) {
    return 'Deterministic fixture'
  }
  return `${PROVIDER[attempt.selection.provider]} · ${attempt.actual_model ?? attempt.selection.model}`
}

/**
 * The session page's header: step and subject, provider and model, where it runs, its web
 * setting, its span from when it was first queued, and how many attempts it has had.
 */
export function SessionPageHeader({
  title,
  session,
  lotHref,
}: {
  title: string
  session: Metadata
  lotHref?: string
}) {
  const headingId = useId()
  const ordered = attemptsOldestFirst(session.attempts)
  const first = ordered[0]
  const current =
    session.attempts.find((attempt) => attempt.id === session.current_attempt_id) ??
    ordered[ordered.length - 1]
  const count = session.attempts.length
  return (
    <Header aria-labelledby={headingId}>
      <TitleRow>
        <h2 id={headingId}>{title}</h2>
        <StatePill state={workState(current.state)} />
      </TitleRow>
      <Facts>
        {modelWords(current)} · {RUNS_ON[current.runs_on]} · {webWords(current)} · queued{' '}
        <EventTime at={first.queued_at} />
        {current.ended && (
          <>
            {current.ended.source === 'transition' ? ' to ' : ' · last activity '}
            <EventTime at={current.ended.at} />
          </>
        )}{' '}
        · {count} {count === 1 ? 'attempt' : 'attempts'}
      </Facts>
      {lotHref && <Link href={lotHref}>Open lot in Review</Link>}
      <DebugDetails
        label="Session"
        rows={[
          { label: 'Job', value: session.job_id },
          { label: 'Current attempt', value: session.current_attempt_id },
          { label: 'Profile', value: current.profile_id },
          { label: 'Inbox read to', value: session.inbox_acked_seq },
        ]}
      />
    </Header>
  )
}

const Header = styled.section`
  display: grid;
  gap: ${space[3]};
  min-width: 0;
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  h2 {
    ${type.h1}
    margin: 0;
  }
`

const Facts = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
`

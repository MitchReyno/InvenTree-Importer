import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type { AgentSessionListDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import { Button, Notice, PageTitle, Panel, Paragraph, Small } from '../ui/primitives'
import { batchHref, processingStepFor } from '../../navigation/batch-route'

type Session = AgentSessionListDto['sessions'][number]
type View = 'All' | 'Queued' | 'Active' | 'Completed' | 'Needs attention'
const FINISHED = new Set(['ready', 'failed', 'cancelled', 'superseded', 'interrupted'])

function sessionGroup(session: Session): View {
  if (session.occupies_lane) {
    return 'Active'
  }
  if (session.state === 'queued') {
    return 'Queued'
  }
  if (FINISHED.has(session.state)) {
    return 'Completed'
  }
  return 'Needs attention'
}

export function AgentSessions({ client }: { client: ReturnType<typeof agentsClient> }) {
  const scope = useServerScope()
  const poll = useRetainedPollInterval()
  const [view, setView] = useState<View>('All')
  const [before, setBefore] = useState<string>()
  // Global history can include streams beyond the bounded live subscription.
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'agent-sessions', before ?? 'newest'),
    queryFn: () => client.sessions(before),
    refetchInterval: poll === false ? 10000 : poll,
  })
  const sessions = query.data?.sessions ?? []
  const shown = sessions.filter((session) => view === 'All' || sessionGroup(session) === view)
  const unavailable = query.isError || query.fetchStatus === 'paused'
  return (
    <Panel>
      <PageTitle>Agent sessions</PageTitle>
      <Paragraph>
        Each session keeps the model selected when queued. Suggestions and human questions appear in
        the batch's Processing view.
      </Paragraph>
      <Filters aria-label="Session views">
        {(['All', 'Queued', 'Active', 'Completed', 'Needs attention'] as const).map((name) => (
          <Button key={name} aria-pressed={view === name} onClick={() => setView(name)}>
            {name}
          </Button>
        ))}
      </Filters>
      {unavailable && (
        <Notice role="alert">
          Session connection unavailable. Retained results may be stale.{' '}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </Notice>
      )}
      {query.isPending && <Paragraph role="status">Loading sessions…</Paragraph>}
      {query.data && !shown.length && (
        <Paragraph>
          No {view === 'All' ? '' : view.toLowerCase() + ' '}sessions on this page.
        </Paragraph>
      )}
      <List>
        {shown.map((session) => (
          <li key={session.attempt_id}>
            <header>
              <strong>
                {session.selection
                  ? `${session.selection.provider === 'codex' ? 'Codex' : 'Claude Code'} · ${session.selection.model}`
                  : 'Synthetic session'}
              </strong>
              <span>{session.state.replaceAll('_', ' ')}</span>
            </header>
            <Paragraph>
              {session.stage} · {session.progress}
              {!session.latest_on_job && ' · retained historical attempt'}
            </Paragraph>
            <Small>
              {session.selection &&
                `${session.selection.authentication === 'subscription' ? 'Subscription login' : 'API key'} · default revision ${session.settings_revision} · `}
              queued {new Date(session.queued_at).toLocaleString()}
            </Small>
            {session.actual_model && <Paragraph>Resolved model: {session.actual_model}</Paragraph>}
            {session.native_session_id && (
              <Small>Native session: {session.native_session_id}</Small>
            )}
            {session.occupies_lane && (
              <Notice>
                The native command holds the account lane until confirmed stopped. A crashed
                supervisor requires host recovery; restarting never replays it.
              </Notice>
            )}
            <Paragraph>
              <a
                href={batchHref(session.batch_id, {
                  tab: 'processing',
                  step: processingStepFor(session.stage),
                })}
              >
                Open batch processing and controls
              </a>
            </Paragraph>
          </li>
        ))}
      </List>
      <Filters>
        <Button disabled={!before} onClick={() => setBefore(undefined)}>
          Newest sessions
        </Button>
        <Button
          disabled={!query.data?.next_before || unavailable}
          onClick={() => setBefore(query.data?.next_before ?? undefined)}
        >
          Older sessions
        </Button>
      </Filters>
      <Small>
        History is paginated. Filters apply to the current page. Completed includes failed,
        cancelled and interrupted outcomes. Credentials and private reasoning are excluded.
      </Small>
    </Panel>
  )
}

const Filters = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
`
const List = styled.ul`
  list-style: none;
  padding: 0;
  display: grid;
  gap: 12px;
  li {
    border: 1px solid ${color.line};
    border-radius: 8px;
    padding: 16px;
    overflow-wrap: anywhere;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
  }
`

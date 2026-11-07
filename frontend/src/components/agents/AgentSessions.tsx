import {
  SessionFailureDetails,
  FAILED_SESSION_STATES,
  type FailureLoader,
} from './SessionFailureDetails'
import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import type { AgentSessionListDto, AgentSettingsDto } from '@invimport/contracts'
import { batchHref, processingStepFor } from '../../navigation/batch-route'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import { SESSION_STATE, STEP_LABEL } from '../processing/ProcessingParts'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { FilterChips } from '../ui/FilterChips'
import { Pill } from '../ui/Pill'

type Session = AgentSessionListDto['sessions'][number]
type Filter = 'all' | 'running' | 'waiting' | 'queued' | 'finished'

export type BatchNames = { title: string; subjects: ReadonlyMap<string, string> }

type Props = {
  client: {
    sessions: (before?: string) => Promise<AgentSessionListDto>
    failure?: FailureLoader
    settings: () => Promise<AgentSettingsDto>
  }
  /** Names a batch and its subjects; sessions carry only identifiers. */
  batches: (batchId: string) => Promise<BatchNames>
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'waiting', label: 'Waiting for you' },
  { id: 'queued', label: 'Queued' },
  { id: 'finished', label: 'Finished today' },
]

const FINISHED = new Set(['ready', 'failed', 'cancelled', 'superseded', 'interrupted'])

const isWaiting = (session: Session) =>
  session.session_state === 'waiting_input' || session.state === 'waiting_for_user'

function finishedToday(session: Session) {
  if (!FINISHED.has(session.state) || !session.finished_at) {
    return false
  }
  return new Date(session.finished_at).toDateString() === new Date().toDateString()
}

function matches(session: Session, filter: Filter) {
  switch (filter) {
    case 'running':
      return session.occupies_lane
    case 'waiting':
      return isWaiting(session)
    case 'queued':
      return session.state === 'queued'
    case 'finished':
      return finishedToday(session)
    default:
      return true
  }
}

function stateWord(session: Session) {
  if (session.session_state) {
    return SESSION_STATE[session.session_state]
  }
  return { word: session.state.replaceAll('_', ' '), tone: 'neutral' as const }
}

/** When the session entered its current state. */
function since(session: Session) {
  const at = session.finished_at ?? session.started_at ?? session.queued_at
  return new Date(at).toLocaleString()
}

/** Every agent session in scope, grouped by batch, with capacity and what waits for the operator. */
export function AgentSessions({ client, batches }: Props) {
  const scope = useServerScope()
  const poll = useRetainedPollInterval()
  const [filter, setFilter] = useState<Filter>('all')
  const [before, setBefore] = useState<string>()
  // Global history can include streams beyond the bounded live subscription.
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'agent-sessions', before ?? 'newest'),
    queryFn: () => client.sessions(before),
    refetchInterval: poll === false ? 10000 : poll,
  })
  const settings = useQuery({
    queryKey: serverQueryKey(scope, 'agent-settings'),
    queryFn: () => client.settings(),
  })
  const sessions = query.data?.sessions ?? []
  const batchIds = [...new Set(sessions.map((session) => session.batch_id))]
  const names = useQueries({
    queries: batchIds.map((batchId) => ({
      queryKey: serverQueryKey(scope, 'agent-batch-names', batchId),
      queryFn: () => batches(batchId),
    })),
  })

  const nameOf = (batchId: string) => names[batchIds.indexOf(batchId)]?.data

  const unavailable = query.isError || query.fetchStatus === 'paused'
  const supported = query.data?.sessions_supported !== false
  const shown = sessions.filter((session) => matches(session, filter))
  const limit = settings.data?.session_concurrency

  return (
    <Page>
      <Title>Agents</Title>
      {unavailable && (
        <div role="alert">
          <Banner tone="bad" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>
            Session connection unavailable. Retained results may be stale.
          </Banner>
        </div>
      )}
      {query.isPending && <Muted role="status">Loading sessions…</Muted>}
      {query.data && !supported && (
        <Banner tone="info">
          Agent sessions are not available for this setup: the server's processing profile does not
          run agent sessions. Processing still shows its retained work.
        </Banner>
      )}
      {query.data && supported && (
        <>
          <Summary aria-label="Summary">
            <div>
              <strong>
                {limit === undefined
                  ? `${sessions.filter((session) => session.occupies_lane).length} slots in use`
                  : `${sessions.filter((session) => session.occupies_lane).length} of ${limit} slots in use`}
              </strong>
              <Muted>Waiting sessions hold no slot.</Muted>
            </div>
            <div>
              <strong>{sessions.filter(isWaiting).length} waiting for you</strong>
            </div>
            <div>
              <strong>
                {settings.data?.selection
                  ? `${settings.data.selection.provider === 'codex' ? 'Codex' : 'Claude Code'} · ${settings.data.selection.model}`
                  : 'No model chosen'}
              </strong>
              <Muted>Model for new sessions</Muted>
            </div>
          </Summary>
          <FilterChips
            label="Session filters"
            options={FILTERS.map((item) => ({
              id: item.id,
              label: item.label,
              count: sessions.filter((session) => matches(session, item.id)).length,
            }))}
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
          />
          {shown.length === 0 && <Muted>No sessions match this filter on this page.</Muted>}
          {batchIds
            .filter((batchId) => shown.some((session) => session.batch_id === batchId))
            .map((batchId) => {
              const named = nameOf(batchId)
              const title = named?.title ?? 'Batch'
              return (
                <Group key={batchId} aria-label={title}>
                  <GroupHead>
                    <h2>{title}</h2>
                    <a href={batchHref(batchId, { tab: 'processing', step: 'overview' })}>
                      Open Processing
                    </a>
                  </GroupHead>
                  <Rows>
                    {shown
                      .filter((session) => session.batch_id === batchId)
                      .map((session) => {
                        const subject =
                          session.subject_id === null
                            ? 'Whole batch'
                            : (named?.subjects.get(session.subject_id) ?? 'Unknown subject')
                        const label = `${STEP_LABEL[processingStepFor(session.stage)] ?? 'Processing'} · ${subject}`
                        const state = stateWord(session)
                        return (
                          <li key={session.attempt_id} aria-label={`${label} session`}>
                            <div>
                              <strong>{label}</strong>
                              {session.latest_status && <span>{session.latest_status.text}</span>}
                              <Muted>
                                Since {since(session)}
                                {!session.latest_on_job && ' · an earlier attempt'}
                                {isWaiting(session) && ' · holds no slot'}
                              </Muted>
                            </div>
                            <Pill tone={state.tone}>{state.word}</Pill>
                            {(session.failure ||
                              FAILED_SESSION_STATES.has(
                                session.session_state ?? session.state,
                              )) && (
                              <SessionFailureDetails
                                key={`${session.attempt_id}:${session.failure?.id ?? 'legacy'}`}
                                attemptId={session.attempt_id}
                                failure={session.failure}
                                load={client.failure}
                              />
                            )}
                            {session.occupies_lane && FINISHED.has(session.state) && (
                              <Muted>
                                Still holds its slot until the command is confirmed stopped.
                              </Muted>
                            )}
                          </li>
                        )
                      })}
                  </Rows>
                </Group>
              )
            })}
          <Paging>
            <Button variant="ghost" disabled={!before} onClick={() => setBefore(undefined)}>
              Newest sessions
            </Button>
            <Button
              variant="ghost"
              disabled={!query.data.next_before || unavailable}
              onClick={() => setBefore(query.data?.next_before ?? undefined)}
            >
              Older sessions
            </Button>
          </Paging>
          <Muted>Filters and counts cover this page of history.</Muted>
        </>
      )}
    </Page>
  )
}

const Page = styled.div`
  display: grid;
  gap: ${space[6]};
`

const Title = styled.h1`
  margin: 0;
  ${type.h1}
`

const Muted = styled.span`
  font-size: 12.5px;
  color: ${color.muted};
`

const Summary = styled.section`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${space[4]};
  > div {
    display: grid;
    gap: ${space[2]};
    padding: ${space[6]};
    border: 1px solid ${color.line};
    border-radius: ${radius.card};
    background: ${color.surface};
  }
`

const Group = styled.section`
  display: grid;
  gap: ${space[4]};
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const GroupHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space[4]};
  h2 {
    margin: 0;
    ${type.h2}
  }
  a {
    color: ${color.accent};
  }
`

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  > li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[4]};
    padding: ${space[4]} 0;
    border-top: 1px solid ${color.line};
    overflow-wrap: anywhere;
  }
  > li:first-child {
    border-top: 0;
  }
  > li > div {
    display: grid;
    flex: 1;
    min-width: 0;
  }
`

const Paging = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`

import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import styled from 'styled-components'
import type { AgentSessionListDto, AgentSettingsDto } from '@invimport/contracts'
import { batchHref, processingStepFor, sessionHref } from '#/navigation/batch-route'
import { serverQueryKey } from '#/queries/scope'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'
import {
  AiMark,
  Link,
  linkTouchArea,
  Banner,
  Button,
  FilterChips,
  Pill,
  DataTable,
  TableWrap,
} from '#/components/ui'
import { SESSION_STATE, STEP_LABEL } from '#/components/processing/ProcessingParts'
import { PauseButton } from './PauseButton'
import { PauseAllAgents } from './PauseAllAgents'
import { slotUse } from './slot-use'
import {
  FAILED_SESSION_STATES,
  SessionFailureDetails,
  type FailureLoader,
} from './SessionFailureDetails'
import { useServerScope, useRetainedPollInterval } from '#/context'

type Session = AgentSessionListDto['sessions'][number]
type Filter = 'all' | 'running' | 'waiting' | 'queued' | 'finished'

export type BatchNames = { title: string; subjects: ReadonlyMap<string, string> }

type Props = {
  client: {
    sessions: (before?: string) => Promise<AgentSessionListDto>
    failure?: FailureLoader
    settings: () => Promise<AgentSettingsDto>
    /** Pauses or resumes one batch's sessions; absent where this setup cannot. */
    pause?: (batchId: string, paused: boolean) => Promise<unknown>
    /** Pauses or resumes every batch's sessions at once. */
    pauseAll?: (paused: boolean) => Promise<unknown>
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
  // A paused batch's unfinished session starts nothing new until Resume.
  if (session.paused && !FINISHED.has(session.state) && session.session_state !== 'finished') {
    return { word: 'Paused', tone: 'neutral' as const }
  }
  if (session.session_state) {
    return SESSION_STATE[session.session_state]
  }
  return { word: session.state.replaceAll('_', ' '), tone: 'neutral' as const }
}

/** When the session entered its current state, as a short 24-hour time. */
function since(session: Session) {
  const at = session.finished_at ?? session.started_at ?? session.queued_at
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

/** Every agent session in scope, grouped by batch, with capacity and what waits for the operator. */
export function AgentSessions({ client, batches }: Props) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const poll = useRetainedPollInterval()

  // A pause shows once the list is read again, so a refused one leaves the old state shown.
  const reread = () =>
    queryClient.invalidateQueries({ queryKey: serverQueryKey(scope, 'agent-sessions') })

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

  // The account list is bounded; each session row says its own batch's pause, so both count.
  const pausedBatches = new Set([
    ...(query.data?.paused_batch_ids ?? []),
    ...sessions.filter((session) => session.paused).map((session) => session.batch_id),
  ])
  const { inUse, queued } = slotUse(sessions)

  return (
    <Page>
      <Head>
        <div>
          <Title>
            <AiMark size="lg">Agents</AiMark>
          </Title>
          <Muted>
            Every agent session across your batches. Open a batch's Processing to see its steps and
            chat with it.
          </Muted>
        </div>
        {query.data && supported && (
          <Button as="a" href="#settings">
            Agent settings
          </Button>
        )}
      </Head>
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
            <Block>
              <Label>Running now</Label>
              {limit !== undefined && (
                <Slots aria-hidden="true">
                  {Array.from({ length: limit }, (_, index) => (
                    <span key={index} data-used={index < inUse} />
                  ))}
                </Slots>
              )}
              <Muted>
                {limit === undefined
                  ? `${inUse} slots in use`
                  : `${inUse} of ${limit} slots in use`}
                {queued > 0 && ` · ${queued} queued`}
              </Muted>
            </Block>
            <Block>
              <Label>Default for new sessions</Label>
              <span>
                {settings.data?.selection
                  ? `${settings.data.selection.provider === 'codex' ? 'Codex' : 'Claude Code'} · ${settings.data.selection.model}`
                  : 'No model chosen'}
              </span>
            </Block>
            <Block>
              <Label>Waiting for you</Label>
              <span>{sessions.filter(isWaiting).length} waiting for you</span>
              <Muted>Waiting sessions hold no slot.</Muted>
            </Block>
            <Push>
              <PauseAllAgents pauseAll={client.pauseAll} list={query.data} />
            </Push>
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

              // Counted over the page's sessions, so the filter does not hide who is waiting.
              const waitingIn = (id: string) =>
                sessions.filter((session) => session.batch_id === id && isWaiting(session)).length

              const title = named?.title ?? 'Batch'
              const rows = shown
                .filter((session) => session.batch_id === batchId)
                .map((session) => {
                  const subject =
                    session.subject_id === null
                      ? 'Whole batch'
                      : (named?.subjects.get(session.subject_id) ?? 'Unknown subject')
                  const step = STEP_LABEL[processingStepFor(session.stage)] ?? 'Processing'
                  const state = stateWord(session)
                  const notes = [
                    session.latest_status?.text,
                    !session.latest_on_job && 'an earlier attempt',
                    isWaiting(session) && 'holds no slot',
                    session.occupies_lane &&
                      FINISHED.has(session.state) &&
                      'still holds its slot until the command is confirmed stopped',
                  ].filter(Boolean)
                  return {
                    id: session.attempt_id,
                    label: `${step} · ${subject}`,
                    cells: {
                      step: {
                        value: step,
                        content: (
                          <Link
                            href={sessionHref(
                              batchId,
                              processingStepFor(session.stage),
                              session.job_id,
                            )}
                            // The drawer shows a job's latest attempt, so an earlier row says so.
                            aria-label={`${session.latest_on_job ? 'Open session' : 'Open latest session'}: ${step} · ${subject}`}
                          >
                            {step}
                          </Link>
                        ),
                      },
                      lot: { value: subject },
                      status: {
                        value: notes.join(' · '),
                        // A failed session's retained diagnostics open beside its status line.
                        ...(session.failure ||
                        FAILED_SESSION_STATES.has(session.session_state ?? session.state)
                          ? {
                              content: (
                                <>
                                  {notes.join(' · ')}
                                  <SessionFailureDetails
                                    key={`${session.attempt_id}:${session.failure?.id ?? 'legacy'}`}
                                    attemptId={session.attempt_id}
                                    failure={session.failure}
                                    load={client.failure}
                                  />
                                </>
                              ),
                            }
                          : {}),
                      },
                      state: {
                        value: state.word,
                        content: <Pill tone={state.tone}>{state.word}</Pill>,
                      },
                      since: { value: since(session) },
                    },
                  }
                })
              return (
                <Group key={batchId} aria-label={title}>
                  <GroupHead>
                    <h2>{title}</h2>
                    {waitingIn(batchId) > 0 && (
                      <Pill status="needs-answer">{waitingIn(batchId)} need you</Pill>
                    )}
                    {client.pause && (
                      <PauseButton
                        paused={pausedBatches.has(batchId)}
                        change={async (paused) => {
                          await client.pause!(batchId, paused)
                          await reread()
                        }}
                      />
                    )}
                    <a href={batchHref(batchId, { tab: 'processing', step: 'overview' })}>
                      Open Processing
                    </a>
                  </GroupHead>
                  <DataTable caption={`${title} sessions`} columns={COLUMNS} rows={rows} />
                </Group>
              )
            })}
          {(before || query.data.next_before) && (
            <Paging aria-label="Session pages">
              <Button size="sm" disabled={!before} onClick={() => setBefore(undefined)}>
                Newest sessions
              </Button>
              <Button
                size="sm"
                disabled={!query.data.next_before || unavailable}
                onClick={() => setBefore(query.data?.next_before ?? undefined)}
              >
                Older sessions
              </Button>
            </Paging>
          )}
          <Muted>Filters and counts cover this page of history.</Muted>
        </>
      )}
    </Page>
  )
}

const COLUMNS = [
  { id: 'step', header: 'Step', nowrap: true },
  { id: 'lot', header: 'Lot' },
  { id: 'status', header: 'Latest status' },
  { id: 'state', header: 'State', nowrap: true },
  { id: 'since', header: 'Since', mono: true, nowrap: true },
]

const Page = styled.div`
  display: grid;
  gap: ${space[8]};
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${space[4]} ${space[8]};
  > div {
    display: grid;
    gap: ${space[2]};
  }
`

const Title = styled.h1`
  margin: 0;
  ${type.h1}
`

const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

/** One card: what runs now, the model, what waits for the operator, and Pause. */
const Summary = styled.section`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[6]} ${space[9]};
  padding: ${space[6]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Block = styled.div`
  display: grid;
  gap: ${space[1]};
`

const Label = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Slots = styled.span`
  display: flex;
  gap: ${space[1]};
  span {
    width: 28px;
    height: 8px;
    border-radius: ${radius.sm};
    background: ${color.surface2};
  }
  span[data-used='true'] {
    background: ${color.accent};
  }
`

const Push = styled.div`
  margin-left: auto;
`

const Group = styled.section`
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${TableWrap} {
    border: 0;
    border-radius: 0;
  }
`

const GroupHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  padding: ${space[5]} ${space[7]};
  border-bottom: 1px solid ${color.line};
  h2 {
    margin: 0;
    ${type.h3}
  }
  a {
    margin-left: auto;
    color: ${color.accent};
    ${linkTouchArea}
  }
`

const Paging = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`

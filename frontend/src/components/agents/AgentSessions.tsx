import { useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import styled from 'styled-components'
import {
  AGENT_SESSION_FILTERS,
  type AgentSessionDto,
  type AgentSessionFilter,
  type AgentSessionListDto,
  type AgentSettingsDto,
} from '@invimport/contracts'
import { batchHref } from '#/navigation/batch-route'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'
import {
  AiMark,
  linkTouchArea,
  Banner,
  Button,
  FilterChips,
  Pill,
  onField,
  raisedOnField,
  PageStack,
  ReadState,
  HelpButton,
} from '#/components/ui'
import { FILTER_LABELS, NOTHING_MATCHES, plural, type SessionListRead } from '#/agents/session-list'
import { useSessionList } from '#/agents/useSessionList'
import { PauseButton } from './PauseButton'
import { PauseAllAgents } from './PauseAllAgents'
import { AgentsSkeleton } from './AgentsSkeleton'
import { AgentSessionTable } from './AgentSessionTable'
import type { FailureLoader } from './SessionFailureDetails'
import { useServerScope, useRetainedPollInterval } from '#/context'

export type BatchNames = {
  title: string
  subjects: ReadonlyMap<string, string>
  /** Lots that are not retired, which Review can open. */
  liveLots?: ReadonlySet<string>
}

type Props = {
  client: {
    sessions: SessionListRead
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

type BatchSummary = AgentSessionListDto['batches'][number]

/** The batches to show, in the summary's order, with any batch a row names past its cap. */
function shownBatches(list: AgentSessionListDto, rows: readonly AgentSessionDto[]) {
  const listed = new Set(list.batches.map((batch) => batch.batch_id))
  const extra: BatchSummary[] = []
  for (const row of rows) {
    if (!listed.has(row.batch_id)) {
      listed.add(row.batch_id)
      extra.push({
        batch_id: row.batch_id,
        archived: row.archived,
        sessions: 1,
        matching: 1,
        first_started_at: null,
      })
    }
  }
  return [...list.batches, ...extra]
}

/** Every agent session in scope, one row per session, grouped by batch, opening on what needs attention. */
export function AgentSessions({ client, batches }: Props) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const poll = useRetainedPollInterval()

  // A pause shows once the list is read again, so a refused one leaves the old state shown.
  const reread = () =>
    queryClient.invalidateQueries({ queryKey: serverQueryKey(scope, 'agent-sessions') })

  const [filter, setFilter] = useState<AgentSessionFilter>('needs_attention')
  // Global history can include streams beyond the bounded live subscription.
  const sessionList = useSessionList(client.sessions, {
    filter,
    refetchInterval: poll === false ? 10000 : poll,
  })
  const { fresh, list, rows } = sessionList
  const query = fresh.query
  const settings = useFreshRead({
    queryKey: serverQueryKey(scope, 'agent-settings'),
    queryFn: () => client.settings(),
  }).query
  // Pause and Resume send no revision, so they wait for a read started after the last live hint.
  const pauseReason = fresh.settledAfterHint ? undefined : (fresh.reason ?? 'Updating…')
  const groups = list ? shownBatches(list, rows) : []
  const names = useQueries({
    queries: groups.map((batch) => ({
      queryKey: serverQueryKey(scope, 'agent-batch-names', batch.batch_id),
      queryFn: () => batches(batch.batch_id),
    })),
  })

  const nameOf = (batchId: string) =>
    names[groups.findIndex((batch) => batch.batch_id === batchId)]?.data

  const supported = list?.sessions_supported !== false
  const limit = settings.data?.session_concurrency

  // The account list is bounded; each session row says its own batch's pause, so both count.
  const pausedBatches = new Set([
    ...(list?.paused_batch_ids ?? []),
    ...rows.filter((session) => session.paused).map((session) => session.batch_id),
  ])
  const inUse = list?.totals.slots_in_use ?? 0
  const queued = list?.totals.queued ?? 0

  return (
    <Page>
      <Head>
        <TitleRow>
          <Title>
            <AiMark size="lg">Agents</AiMark>
          </Title>
          <HelpButton
            label="About Agents"
            explanation="Every agent session across your batches. Open a batch's Processing to see its steps and chat with it."
          />
        </TitleRow>
        {list && supported && (
          <Button as="a" href="#settings">
            Agent settings
          </Button>
        )}
      </Head>
      <ReadState
        phase={fresh.phase}
        hasData={list !== undefined}
        skeleton={<AgentsSkeleton />}
        failure={
          <div role="alert">
            <Banner tone="bad" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>
              Session connection unavailable. Retained results may be stale.
            </Banner>
          </div>
        }
      >
        {list && !supported && (
          <Banner tone="info">
            Agent sessions are not available for this setup: the server's processing profile does
            not run agent sessions. Processing still shows its retained work.
          </Banner>
        )}
        {list && supported && (
          <>
            <Summary aria-label="Summary">
              <Block>
                <Label>Working now</Label>
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
                  {settings.data?.default_provider
                    ? `${settings.data.default_provider === 'codex' ? 'Codex' : 'Claude Code'} · ${settings.data.providers[settings.data.default_provider].default_model}`
                    : 'No model chosen'}
                </span>
              </Block>
              <Block>
                <BlockHead>
                  <Label>Needs attention</Label>
                  <HelpButton
                    label="About waiting sessions"
                    explanation="A session waiting for your answer does not use a slot, so another session can run meanwhile."
                  />
                </BlockHead>
                <span>
                  {plural(list.counts.needs_attention, 'session')} · {list.totals.waiting} waiting
                  for you
                </span>
              </Block>
              <Push>
                <PauseAllAgents
                  pauseAll={client.pauseAll}
                  list={list}
                  unavailableReason={pauseReason}
                  readyNow={fresh.settledAfterHintNow}
                />
              </Push>
            </Summary>
            <FilterChips
              label="Session filters"
              options={AGENT_SESSION_FILTERS.map((id) => ({
                id,
                label: FILTER_LABELS[id],
                count: list.counts[id] ?? null,
              }))}
              value={filter}
              onChange={(value) => setFilter(value as AgentSessionFilter)}
            />
            {groups.length === 0 && <FieldNote>No sessions match this filter.</FieldNote>}
            {groups.map((batch) => {
              const batchNames = nameOf(batch.batch_id)
              const title = batchNames?.title ?? 'Batch'
              const processing = (
                <a href={batchHref(batch.batch_id, { tab: 'processing', step: 'overview' })}>
                  Open Processing
                </a>
              )
              if (batch.matching === 0) {
                return (
                  <Collapsed key={batch.batch_id} aria-label={title}>
                    <h2>{title}</h2>
                    <Muted>
                      {plural(batch.sessions, 'session')} · {NOTHING_MATCHES[filter]}
                    </Muted>
                    {batch.archived && <Pill tone="neutral">Archived</Pill>}
                    {processing}
                  </Collapsed>
                )
              }
              const batchRows = rows.filter((row) => row.batch_id === batch.batch_id)
              return (
                <Group key={batch.batch_id} aria-label={title}>
                  <GroupHead>
                    <h2>{title}</h2>
                    <Muted>
                      {plural(batch.matching, 'session')}
                      {batch.matching !== batch.sessions && ` of ${batch.sessions}`}
                    </Muted>
                    {batch.archived && <Pill tone="neutral">Archived</Pill>}
                    {client.pause && !batch.archived && (
                      <PauseButton
                        paused={pausedBatches.has(batch.batch_id)}
                        unavailableReason={pauseReason}
                        readyNow={fresh.settledAfterHintNow}
                        change={async (paused) => {
                          await client.pause!(batch.batch_id, paused)
                          await reread()
                        }}
                      />
                    )}
                    {processing}
                  </GroupHead>
                  {batchRows.length > 0 && (
                    <AgentSessionTable
                      caption={`${title} sessions`}
                      rows={batchRows}
                      names={batchNames}
                      loadFailure={client.failure}
                    />
                  )}
                  {batchRows.length < batch.matching && (
                    <More>
                      {plural(batch.matching - batchRows.length, 'more session')} on later pages.
                    </More>
                  )}
                </Group>
              )
            })}
            {sessionList.canLoadMore && (
              <Paging aria-label="Session pages">
                <Button size="sm" disabled={sessionList.loadingMore} onClick={sessionList.loadMore}>
                  Load more
                </Button>
              </Paging>
            )}
            {sessionList.moreFailed && (
              <FieldNote role="alert">More sessions couldn’t be loaded.</FieldNote>
            )}
          </>
        )}
      </ReadState>
    </Page>
  )
}

const Page = styled(PageStack)``

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]} ${space[8]};
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[3]};
`

const Title = styled.h1`
  margin: 0;
  ${type.h1}
  ${onField}
`

const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

/** Muted text placed directly on the page, which takes a ground patch behind the whole window. */
const FieldNote = styled(Muted)`
  display: block;
  ${onField}
`

/** One card: what runs now, the model, what needs the operator, and Pause. */
const Summary = styled.section`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[6]} ${space[9]};
  padding: ${space[6]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`

const Block = styled.div`
  display: grid;
  gap: ${space[1]};
`

const BlockHead = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
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
  ${raisedOnField}
`

const groupLine = `
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  h2 {
    margin: 0;
    ${type.h3}
  }
  a {
    margin-left: auto;
    color: ${color.accent};
  }
`

const GroupHead = styled.div`
  ${groupLine}
  padding: ${space[5]} ${space[7]};
  border-bottom: 1px solid ${color.line};
  a {
    ${linkTouchArea}
  }
`

/** A batch with nothing matching the filter, as one line. */
const Collapsed = styled.section`
  ${groupLine}
  padding: ${space[4]} ${space[7]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
  a {
    ${linkTouchArea}
  }
`

const More = styled.p`
  margin: 0;
  padding: ${space[4]} ${space[7]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Paging = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

import { useEffect, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { IntakeRequestError } from '@invimport/contracts/client'
import type { ProcessingJobDto } from '@invimport/contracts'
import type { FailureLoader } from '#/components/agents/SessionFailureDetails'
import { Banner, Button, FilterChips, Link, Small, media } from '#/components/ui'
import { batchHref, type ProcessingStep } from '#/navigation/batch-route'
import { conversation, filterCount, type ConversationFilter } from '#/processing/session-history'
import { useSessionPageHistory } from '#/processing/useSessionHistory'
import { useQuestionsWithDrafts } from '#/processing/useQuestionsWithDrafts'
import type { ProcessingClient } from '#/processing/types'
import { space } from '#/theme/generated/tokens'
import { startFreshReason } from '#/processing/start-fresh'
import { SessionChatPanel } from './SessionChatPanel'
import {
  newestInboxSeq,
  unreadPendingSends,
  usePendingSendKey,
  usePendingSends,
} from '#/processing/pending-sends'
import { SessionConversation } from './SessionConversation'
import { SessionPageHeader } from './SessionPageHeader'
import { SessionPagePanels } from './SessionPagePanels'
import { SessionSkeleton } from './SessionSkeleton'
import { STEP_LABEL } from './ProcessingParts'

const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'inputs', label: 'Your inputs' },
  { id: 'photos', label: 'Photos' },
  { id: 'web', label: 'Web' },
]

type Props = {
  batchId: string
  jobId: string
  step: ProcessingStep
  client: Required<Pick<ProcessingClient, 'history' | 'chat'>>
  loadFailure?: FailureLoader
  /** The job as the batch's Processing read has it; absent until read or once it has left. */
  job: ProcessingJobDto | undefined
  subjectLabel: (id: string | null) => string
  /** Whether the subject is a live lot, so the header can link it in Review. */
  isLot: (id: string | null) => boolean
  answerForm: (questionId: string) => ReactNode
  /** The session's answered questions, folded below its open ones. */
  answered?: ReactNode
  /** A question's answer form on this page holds an unsaved draft. */
  isAnswerDirty: (questionId: string) => boolean
  /** Why a message can't be sent now; absent when it can. */
  sendUnavailable?: string
  startFresh: () => void
  freshDisabled: boolean
  /** Why Start fresh would be refused now, from the batch's Processing read. */
  freshReason?: string
}

const isNotFound = (error: unknown) =>
  error instanceof IntakeRequestError &&
  (error.code === 'session_not_found' || error.status === 404)

/**
 * A session's page inside its batch's Processing: its whole history as one conversation, oldest
 * first, with filters, Load older, the message box, and panels of what it viewed and cited.
 */
export function SessionPage(props: Props) {
  const { batchId, jobId, step, client } = props
  const { query, loadOlder, older } = useSessionPageHistory(client.history, batchId, jobId)
  const [filter, setFilter] = useState<ConversationFilter>('all')
  // An entry to bring into view once the filter that showed it has been cleared.
  const [reveal, setReveal] = useState<string | null>(null)
  // Moves focus in the DOM to the revealed entry after it renders.
  useEffect(() => {
    if (reveal === null) {
      return
    }
    const target = document.getElementById(reveal)
    const focusable = target?.querySelector<HTMLElement>(':scope > summary') ?? target
    focusable?.scrollIntoView?.({ block: 'center' })
    focusable?.focus()
    setReveal(null)
  }, [reveal])
  const held = query.data
  const questions = useQuestionsWithDrafts(held, props.isAnswerDirty)
  const storeKey = usePendingSendKey(batchId, jobId)
  const pending = usePendingSends(storeKey)
  // A definite "not found" wins over history read earlier, which may belong to another scope.
  if (isNotFound(query.error)) {
    return (
      <div role="status">
        <Banner tone="warn">This session was not found.</Banner>
      </div>
    )
  }
  if (!held) {
    if (query.isError || query.fetchStatus === 'paused') {
      return (
        <div role="alert">
          <Banner tone="bad">Session history is unavailable.</Banner>
        </div>
      )
    }
    return <SessionSkeleton />
  }
  const { session, entries } = held
  const context = {
    batchId,
    jobId,
    step,
    showEntry: (entryId: string) => {
      setFilter('all')
      setReveal(entryId)
    },
  }
  const stepLabel = STEP_LABEL[step] ?? 'Processing'
  const title = `${stepLabel} · ${props.subjectLabel(session.subject_id)}`
  const current = session.attempts.find((attempt) => attempt.id === session.current_attempt_id)
  const sessionState = current?.session_state ?? props.job?.session_state ?? 'queued'
  const shownPending = unreadPendingSends(pending, held)
  const freshReason = props.freshReason ?? startFreshReason(session.start_fresh)
  return (
    <Page>
      <SessionPageHeader
        title={title}
        session={session}
        lotHref={
          props.isLot(session.subject_id)
            ? batchHref(batchId, { tab: 'review', view: 'lots', lotId: session.subject_id! })
            : undefined
        }
      />
      {(query.isRefetchError || query.fetchStatus === 'paused') && (
        <Small role="status">Session history could not be refreshed; showing the last copy.</Small>
      )}
      <Columns>
        <Main>
          <Controls>
            <FilterChips
              label="Show"
              value={filter}
              onChange={(id) => setFilter(id as ConversationFilter)}
              options={FILTERS.map((option) => ({
                ...option,
                count: filterCount(entries, option.id),
              }))}
            />
            {held.before && (
              <Button size="sm" disabled={older === 'loading'} onClick={() => void loadOlder()}>
                Load older
              </Button>
            )}
            {older === 'failed' && <Small role="alert">Older entries couldn’t be loaded.</Small>}
          </Controls>
          <SessionConversation
            label="Session conversation"
            items={conversation({ ...held, entries: questions.entries })}
            working={sessionState === 'running'}
            pending={shownPending}
            filter={filter}
            context={context}
            answerForm={props.answerForm}
            loadFailure={props.loadFailure}
            startFresh={{
              attemptId: session.current_attempt_id,
              run: props.startFresh,
              disabled: props.freshDisabled || session.current_attempt_id !== props.job?.attempt_id,
              reason: freshReason,
            }}
          />
          {props.answered}
          <SessionChatPanel
            storeKey={storeKey}
            batchId={batchId}
            jobId={jobId}
            state={sessionState}
            label={`Message ${stepLabel}`}
            newestInboxSeq={newestInboxSeq(entries)}
            send={(text, key) => client.chat(batchId, jobId, { idempotency_key: key, text }, key)}
            refresh={() => void query.refetch()}
            startFresh={props.startFresh}
            freshReason={freshReason}
            sendUnavailable={props.sendUnavailable}
            freshDisabled={
              props.freshDisabled || session.current_attempt_id !== props.job?.attempt_id
            }
          />
          <Link href={batchHref(batchId, { tab: 'processing', step })}>Back to {stepLabel}</Link>
        </Main>
        <Side>
          <SessionPagePanels
            entries={entries}
            olderRemain={held.before !== undefined}
            context={context}
          />
        </Side>
      </Columns>
    </Page>
  )
}

const Page = styled.div`
  display: grid;
  gap: ${space[6]};
  min-width: 0;
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 18rem);
  gap: ${space[6]};
  align-items: start;
  ${media.compact} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Main = styled.div`
  display: grid;
  gap: ${space[5]};
  min-width: 0;
`

const Side = styled.aside`
  display: grid;
  gap: ${space[5]};
  min-width: 0;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
`

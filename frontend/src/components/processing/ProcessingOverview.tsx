import type { ReactNode } from 'react'
import type { BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { batchHref } from '#/navigation/batch-route'
import type { ProcessingSource, StepProgress } from '#/processing/source'
import type { LotSteps } from '#/processing/lot-steps'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import {
  AiMark,
  EventTime,
  linkTouchArea,
  Count,
  ProgressSegments,
  type ProgressStep,
  StatusTimeline,
  type TimelineEntry,
  NeedsYou,
  HelpButton,
} from '#/components/ui'
import { PauseButton } from '#/components/agents/PauseButton'
import { NeedsYouList } from '#/components/batches/NeedsYouList'
import { Card, CardTitle, Muted, STEP_LABEL, SessionRows, plural } from './ProcessingParts'
import { LotTable } from './LotTable'

type Props = {
  batchId: string
  source: ProcessingSource
  /** The batch instruction field, owned by the workspace that saves it. */
  instructions: ReactNode
  /** Agents' newest status lines across the batch, oldest first. */
  activity: TimelineEntry[]
  /** Starting work by hand, folded into the progress card. */
  queue?: ReactNode
  /** The batch attention read the header counts from; absent while it loads or has failed. */
  attention?: BatchAttentionDto
  /** The attention read failed or paused, so Needs you cannot list everything. */
  attentionUnavailable?: boolean
  /** Each live lot's Research, Images and Inventory state. */
  lots: LotSteps[]
  /** When this batch's first agent session started. */
  startedAt?: string
  /** How many current lots were formed and when the last was, when every time is known. */
  lotsFormed?: { count: number; at: string }
  /** How many sessions may run at once, from the agent settings. */
  sessionLimit?: number
  /** Whether the batch's sessions are paused, and how to pause or resume them. */
  pause?: {
    paused: boolean
    /** Why Pause or Resume waits, such as a read still landing; absent when it is available. */
    unavailableReason?: string
    change: (paused: boolean) => Promise<unknown>
  }
  onOpenSession: (jobId: string) => void
}

const RUNNING_MINIMUM = 0.08

/** A step's bar: done once every attempt is ready, running only while work runs. */
function segment(step: StepProgress): ProgressStep {
  if (step.jobs === 0) {
    return { label: step.label, state: 'waiting' }
  }
  if (step.ready === step.jobs) {
    return { label: step.label, state: 'done' }
  }
  if (step.running > 0) {
    // A sliver stays visible while nothing is ready yet, so running work never draws empty.
    return {
      label: step.label,
      state: 'running',
      fraction: Math.max(step.ready / step.jobs, RUNNING_MINIMUM),
    }
  }
  if (step.failed > 0 && step.queued + step.waiting === 0) {
    return { label: step.label, state: 'failed' }
  }

  // Queued, waiting or stopped work is not running; the counts beneath say which.
  return { label: step.label, state: 'waiting' }
}

/**
 * Processing at a glance, after the canvas: progress, questions and activity on the left, the
 * batch's sessions beside them. Review and Changes counts stay on their tabs.
 */
export function ProcessingOverview({
  batchId,
  source,
  instructions,
  activity,
  queue,
  attention,
  attentionUnavailable = false,
  lots,
  startedAt,
  lotsFormed,
  sessionLimit,
  pause,
  onOpenSession,
}: Props) {
  const runningSessions = source.sessions.filter((session) => session.state === 'running').length
  const working = source.sessions.length
    ? runningSessions
    : source.steps.reduce((total, step) => total + step.running, 0)

  return (
    <Columns>
      <Main>
        <Card aria-label="Progress">
          <TitleRow>
            <CardTitle>
              {working ? `${plural(working, 'agent')} working` : 'No agents working'}
            </CardTitle>
            <HelpButton
              label="About Processing"
              explanation="Agents work on the server. Closing this browser does not cancel saved work."
            />
            {(startedAt || lotsFormed) && (
              <Muted>
                {startedAt && (
                  <>
                    Started <EventTime at={startedAt} />
                  </>
                )}
                {startedAt && lotsFormed && ' · '}
                {lotsFormed && (
                  <>
                    {plural(lotsFormed.count, 'lot')} formed by <EventTime at={lotsFormed.at} />
                  </>
                )}
              </Muted>
            )}
          </TitleRow>
          <ProgressSegments size="lg" steps={source.steps.map(segment)} />
          <StepLabels aria-label="Steps">
            {source.steps.map((step) => (
              <li key={step.step}>
                <a href={batchHref(batchId, { tab: 'processing', step: step.step })}>
                  {step.jobs > 0 ? `${step.label} · ${step.ready} of ${step.jobs}` : step.label}
                </a>
              </li>
            ))}
          </StepLabels>
          {instructions}
          {queue}
        </Card>

        <Card aria-label="Needs you">
          <CardTitle>Needs you</CardTitle>
          <NeedsYouCard
            batchId={batchId}
            attention={attention}
            unavailable={attentionUnavailable}
            source={source}
          />
        </Card>

        {lots.length > 0 && (
          <Card aria-label="Lots">
            <CardTitle>Lots</CardTitle>
            <LotTable batchId={batchId} lots={lots} />
          </Card>
        )}

        <Card aria-label="Recent activity">
          <CardTitle>Recent activity</CardTitle>
          {activity.length === 0 ? (
            <Muted>No agent activity yet.</Muted>
          ) : (
            <StatusTimeline label="Recent activity" entries={activity} />
          )}
        </Card>
      </Main>

      {source.sessions.length > 0 && (
        <Aside>
          <Card aria-label="Agent sessions">
            <TitleRow>
              <CardTitle>
                <AiMark>Agent sessions</AiMark>
              </CardTitle>
              <Count value={source.sessions.length} />
              <Muted>
                {runningSessions} working
                {sessionLimit !== undefined && ` · limit ${sessionLimit}`}
              </Muted>
              {pause && (
                <PauseButton
                  paused={pause.paused}
                  change={pause.change}
                  unavailableReason={pause.unavailableReason}
                />
              )}
            </TitleRow>
            {pause?.paused && <Muted>Paused: no session starts new work until you resume.</Muted>}
            <SessionRows sessions={source.sessions} paused={source.paused} onOpen={onOpenSession} />
            <SmallLink href="#agents">All sessions, every batch</SmallLink>
          </Card>
        </Aside>
      )}
    </Columns>
  )
}

/**
 * Everything the batch header counts, from the same attention read and list. Without that read,
 * only the agent questions this read holds show, and nothing claims the list is empty; a failed
 * read says the list is partial.
 */
function NeedsYouCard({
  batchId,
  attention,
  unavailable,
  source,
}: {
  batchId: string
  attention?: BatchAttentionDto
  unavailable: boolean
  source: ProcessingSource
}) {
  if (attention) {
    return (
      <Inset>
        <NeedsYouList attention={attention} />
      </Inset>
    )
  }
  const partial = unavailable && (
    <Muted role="status">
      Needs you is unavailable, so Review and Changes items are not listed.
      {source.questions.length > 0 && ' Agent questions are shown.'}
    </Muted>
  )
  if (source.questions.length === 0) {
    return partial || <Muted>Updating…</Muted>
  }

  return (
    <>
      {partial}
      <AgentQuestions batchId={batchId} source={source} />
    </>
  )
}

/** The Processing read's own agent questions, oldest first. */
function AgentQuestions({ batchId, source }: { batchId: string; source: ProcessingSource }) {
  return (
    <NeedsYou
      items={source.questions.map((question) => ({
        id: question.id,
        step: STEP_LABEL[question.step],
        title: question.title,
        kind: question.kind,
        assumption: [question.subject, question.assumption].filter(Boolean).join(' · '),
        href: batchHref(batchId, {
          tab: 'processing',
          step: question.step,
          questionId: question.id,
        }),
      }))}
    />
  )
}

/** The shared list's sections carry the popover's inset; in a card they sit on its padding. */
const Inset = styled.div`
  display: grid;
  margin: 0 calc(-1 * ${space[6]});
`

// The canvas's flex bases, as on Capture: the main column takes the room until both no longer fit.
const Columns = styled.div`
  display: flex;
  flex-wrap: wrap;
  /* Wrapped, the columns are stacked page sections and take the page gap. */
  gap: ${space[7]} ${space[9]};
  align-items: flex-start;
`

const Main = styled.div`
  flex: 999 1 600px;
  display: grid;
  gap: ${space[7]};
  min-width: 0;
`

const Aside = styled.aside`
  flex: 1 1 380px;
  display: grid;
  gap: ${space[6]};
  min-width: 0;
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  ${CardTitle} {
    margin: 0;
  }
`

const StepLabels = styled.ul`
  display: flex;
  gap: ${space[1]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    flex: 1;
    display: grid;
    justify-items: center;
    text-align: center;
    min-width: 0;
  }
  a {
    color: ${color.fg};
    font-size: ${typeVar.small.size};
    font-weight: ${typeVar.bodyStrong.weight};
    ${linkTouchArea}
  }
  span {
    ${type.small}
    color: ${color.muted};
  }
`

const SmallLink = styled.a`
  ${type.small}
  color: ${color.accent};
  ${linkTouchArea}
`

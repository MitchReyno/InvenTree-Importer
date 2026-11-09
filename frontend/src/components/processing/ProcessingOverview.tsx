import type { ReactNode } from 'react'
import styled from 'styled-components'
import { batchHref } from '#/navigation/batch-route'
import type { ProcessingSource, StepProgress } from '#/processing/source'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import {
  linkTouchArea,
  Count,
  ProgressSegments,
  type ProgressStep,
  StatusTimeline,
  type TimelineEntry,
  NeedsYou,
} from '#/components/ui'
import { PauseButton } from '#/components/agents/PauseButton'
import {
  Card,
  CardTitle,
  Muted,
  PipelineRows,
  STEP_LABEL,
  SessionRows,
  plural,
  stepOutcome,
} from './ProcessingParts'

type Props = {
  batchId: string
  source: ProcessingSource
  /** The batch instruction field, owned by the workspace that saves it. */
  instructions: ReactNode
  /** Agents' newest status lines across the batch, oldest first. */
  activity: TimelineEntry[]
  /** Starting work by hand, folded into the progress card. */
  queue?: ReactNode
  /** When this batch's first agent session started, as a clock time. */
  started?: string
  /** "N lots formed by HH:MM", when every current lot's time is known. */
  lotsFormed?: string
  /** How many sessions may run at once, from the agent settings. */
  sessionLimit?: number
  /** Whether the batch's sessions are paused, and how to pause or resume them. */
  pause?: { paused: boolean; change: (paused: boolean) => Promise<unknown> }
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
  started,
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
            {(started || lotsFormed) && (
              <Muted>
                {[started && `Started ${started}`, lotsFormed].filter(Boolean).join(' · ')}
              </Muted>
            )}
          </TitleRow>
          <ProgressSegments size="lg" steps={source.steps.map(segment)} />
          <StepLabels aria-label="Steps">
            {source.steps.map((step) => (
              <li key={step.step}>
                <a href={batchHref(batchId, { tab: 'processing', step: step.step })}>
                  {step.label}
                </a>
                <span>{stepOutcome(step)}</span>
              </li>
            ))}
          </StepLabels>
          {instructions}
          {queue}
        </Card>

        <Card aria-label="Needs you">
          <TitleRow>
            <CardTitle>Needs you</CardTitle>
            {source.questions.length > 0 && <Muted>Oldest first</Muted>}
          </TitleRow>
          {source.questions.length === 0 ? (
            <Muted>No open questions.</Muted>
          ) : (
            <NeedsYou
              items={source.questions.map((question) => ({
                id: question.id,
                step: STEP_LABEL[question.step],
                title: question.prompt,
                assumption: [question.subject, question.assumption].filter(Boolean).join(' · '),
                href: batchHref(batchId, {
                  tab: 'processing',
                  step: question.step,
                  questionId: question.id,
                }),
              }))}
            />
          )}
        </Card>

        {(source.pipeline.lead || source.pipeline.lots.length > 0) && (
          <Card aria-label="Pipeline">
            <CardTitle>Pipeline</CardTitle>
            <PipelineRows pipeline={source.pipeline} />
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
              <CardTitle>Agent sessions</CardTitle>
              <Count value={source.sessions.length} />
              <Muted>
                {runningSessions} running
                {sessionLimit !== undefined && ` · limit ${sessionLimit}`}
              </Muted>
              {pause && <PauseButton paused={pause.paused} change={pause.change} />}
            </TitleRow>
            {pause?.paused && <Muted>Paused: no session starts new work until you resume.</Muted>}
            <SessionRows sessions={source.sessions} onOpen={onOpenSession} />
            <SmallLink href="#agents">All sessions, every batch</SmallLink>
          </Card>
        </Aside>
      )}
    </Columns>
  )
}

// The canvas's flex bases, as on Capture: the main column takes the room until both no longer fit.
const Columns = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[9]};
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

import type { ReactNode } from 'react'
import type { BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type { ProcessingSource, StepProgress } from '../../processing/source'
import { color, space, type, typeVar } from '../../theme/generated/tokens'
import { Count, Pill } from '../ui/Pill'
import { ProgressSegments, type ProgressStep } from '../ui/ProgressSegments'
import { StatusTimeline, type TimelineEntry } from '../ui/StatusTimeline'
import {
  Card,
  CardTitle,
  Muted,
  PipelineRows,
  QuestionRows,
  SessionRows,
  plural,
  stepOutcome,
} from './ProcessingParts'

type Props = {
  batchId: string
  source: ProcessingSource
  attention: BatchAttentionDto | undefined
  /** The batch instruction field, owned by the workspace that saves it. */
  instructions: ReactNode
  /** Agents' newest status lines across the batch, oldest first. */
  activity: TimelineEntry[]
  /** Starting work by hand, folded into the progress card. */
  queue?: ReactNode
  onOpenSession: (jobId: string) => void
}

/** A step's bar: done once every attempt is ready, failed when only failures remain. */
function segment(step: StepProgress): ProgressStep {
  if (step.jobs === 0) {
    return { label: step.label, state: 'waiting' }
  }
  if (step.ready === step.jobs) {
    return { label: step.label, state: 'done' }
  }
  if (step.failed > 0 && step.running + step.queued + step.waiting === 0) {
    return { label: step.label, state: 'failed' }
  }

  return { label: step.label, state: 'running', fraction: step.ready / step.jobs }
}

/**
 * Processing at a glance, after the canvas: progress, questions and activity on the left, the
 * batch's sessions and the rest of the batch beside them.
 */
export function ProcessingOverview({
  batchId,
  source,
  attention,
  instructions,
  activity,
  queue,
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
          <CardTitle>
            {working ? `${plural(working, 'agent')} working` : 'No agents working'}
          </CardTitle>
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
            {source.questions.length > 0 && <Count value={source.questions.length} tone="warn" />}
          </TitleRow>
          {source.questions.length === 0 ? (
            <Muted>No open questions.</Muted>
          ) : (
            <QuestionRows batchId={batchId} questions={source.questions} />
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

      <Aside>
        {source.sessions.length > 0 && (
          <Card aria-label="Agent sessions">
            <TitleRow>
              <CardTitle>Agent sessions</CardTitle>
              <Count value={source.sessions.length} />
              <Muted>{runningSessions} running</Muted>
            </TitleRow>
            <SessionRows sessions={source.sessions} onOpen={onOpenSession} />
            <SmallLink href="#agents">All sessions, every batch</SmallLink>
          </Card>
        )}

        <Card as="nav" aria-label="Elsewhere in this batch">
          <Eyebrow>Elsewhere in this batch</Eyebrow>
          <Elsewhere href={batchHref(batchId, { tab: 'review', view: 'lots' })}>
            <Badge aria-hidden="true">
              <Pill tone="ok">{attention ? attention.review.to_check : '–'}</Pill>
            </Badge>
            <span>
              {attention ? `${plural(attention.review.to_check, 'lot')} to check` : 'Review'}
            </span>
            <Go aria-hidden="true">Review →</Go>
          </Elsewhere>
          <Elsewhere href={batchHref(batchId, { tab: 'changes', view: 'ready' })}>
            <Badge aria-hidden="true">
              <Pill tone="acc" glyph="＋">
                {attention ? attention.changes.ready : '–'}
              </Pill>
            </Badge>
            <span>{attention ? `${attention.changes.ready} ready to add` : 'Changes'}</span>
            <Go aria-hidden="true">Changes →</Go>
          </Elsewhere>
        </Card>
      </Aside>
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
  }
  span {
    ${type.small}
    color: ${color.muted};
  }
`

const Eyebrow = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Elsewhere = styled.a`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  color: ${color.fg};
  text-decoration: none;
  span:nth-child(2) {
    flex: 1;
  }
  &:hover span:nth-child(2) {
    text-decoration: underline;
  }
`

const Badge = styled.span`
  display: inline-flex;
`

const Go = styled.span`
  color: ${color.accent};
`

const SmallLink = styled.a`
  ${type.small}
  color: ${color.accent};
`

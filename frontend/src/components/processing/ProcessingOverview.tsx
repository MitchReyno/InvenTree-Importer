import type { ReactNode } from 'react'
import type { BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type { ProcessingSource } from '../../processing/source'
import { color, radius, space } from '../../theme/generated/tokens'
import {
  Card,
  CardTitle,
  Muted,
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
  /** Recent work, newest first. */
  activity?: ReactNode
  onOpenSession: (jobId: string) => void
}

/** Processing at a glance: step progress, sessions, questions, instructions and where to go next. */
export function ProcessingOverview({
  batchId,
  source,
  attention,
  instructions,
  activity,
  onOpenSession,
}: Props) {
  return (
    <Layout>
      <Card aria-labelledby="processing-steps">
        <CardTitle id="processing-steps">Steps</CardTitle>
        <Steps aria-label="Steps">
          {source.steps.map((step) => (
            <li key={step.step}>
              <a href={batchHref(batchId, { tab: 'processing', step: step.step })}>{step.label}</a>
              <span>{stepOutcome(step)}</span>
            </li>
          ))}
        </Steps>
      </Card>

      {source.sessions.length > 0 && (
        <Card aria-label="Sessions">
          <CardTitle>Sessions</CardTitle>
          <SessionRows sessions={source.sessions} onOpen={onOpenSession} />
        </Card>
      )}

      <Card aria-label="Needs you">
        <CardTitle>Needs you</CardTitle>
        {source.questions.length === 0 ? (
          <Muted>No open questions.</Muted>
        ) : (
          <QuestionRows batchId={batchId} questions={source.questions} />
        )}
      </Card>

      <Card aria-label="Batch instructions">
        <CardTitle>Batch instructions</CardTitle>
        {instructions}
      </Card>

      {activity}

      <Glances aria-label="Next">
        <a href={batchHref(batchId, { tab: 'review', view: 'lots' })}>
          {attention ? `${plural(attention.review.to_check, 'lot')} to check` : 'Review'}
        </a>
        <a href={batchHref(batchId, { tab: 'changes', view: 'ready' })}>
          {attention ? `${attention.changes.ready} ready to add` : 'Changes'}
        </a>
      </Glances>
    </Layout>
  )
}

const Layout = styled.div`
  display: grid;
  gap: ${space[3]};
`

const Steps = styled.ul`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${space[2]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: grid;
    gap: ${space[1]};
    padding: ${space['2-5']};
    border: 1px solid ${color.line};
    border-radius: ${radius.card};
  }
  a {
    color: ${color.fg};
    font-weight: 600;
  }
  span {
    font-size: 12.5px;
    color: ${color.muted};
  }
`

const Glances = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  a {
    padding: ${space[2]} ${space[3]};
    border: 1px solid ${color.line};
    border-radius: ${radius.card};
    background: ${color.surface};
    color: ${color.accent};
    font-weight: 600;
  }
`

import type { ReactNode } from 'react'
import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type { ProcessingSource, WorkStep } from '../../processing/source'
import { color, space, type } from '../../theme/generated/tokens'
import { Card, CardTitle, Muted, QuestionRows, SessionRows, stepOutcome } from './ProcessingParts'

type Props = {
  batchId: string
  step: WorkStep
  source: ProcessingSource
  onOpenSession: (jobId: string) => void
  /** The step's outputs: readings, sources, crops or matches. */
  children?: ReactNode
}

/**
 * Every step page has the same parts in the same places: its state, questions, sessions and
 * outputs. Values link to Review and evidence to Capture; the page never edits lots itself.
 */
export function StepPage({ batchId, step, source, onOpenSession, children }: Props) {
  const progress = source.steps.find((item) => item.step === step)
  const questions = source.questions.filter((question) => question.step === step)
  const sessions = source.sessions.filter((session) => session.step === step)
  const label = progress?.label ?? step

  return (
    <Page>
      <Head>
        <Title>{label}</Title>
        {progress && progress.jobs > 0 && <Muted>{stepOutcome(progress)}</Muted>}
        <a href={batchHref(batchId, { tab: 'capture' })}>Evidence in Capture</a>
      </Head>
      {progress?.jobs === 0 && <Muted>No retained work on {label} yet.</Muted>}
      {questions.length > 0 && (
        <Card aria-label="Questions">
          <CardTitle>Questions</CardTitle>
          <QuestionRows batchId={batchId} questions={questions} />
        </Card>
      )}
      {sessions.length > 0 && (
        <Card aria-label="Sessions">
          <CardTitle>Sessions</CardTitle>
          <SessionRows sessions={sessions} onOpen={onOpenSession} />
        </Card>
      )}
      {children && <Outputs aria-label="Outputs">{children}</Outputs>}
    </Page>
  )
}

const Page = styled.div`
  display: grid;
  gap: ${space[3]};
  min-width: 0;
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[2]} ${space[3]};
  a {
    margin-left: auto;
    color: ${color.accent};
  }
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
`

const Outputs = styled.section`
  display: grid;
  gap: ${space[2]};
  min-width: 0;
`

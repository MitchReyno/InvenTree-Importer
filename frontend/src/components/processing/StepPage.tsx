import type { ReactNode } from 'react'
import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type { ProcessingSource, StepProgress, WorkStep } from '../../processing/source'
import { color, icon, radius, space, type, typeVar } from '../../theme/generated/tokens'
import { Spinner } from '../ui/Loading'
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
        {progress && <StateDisc progress={progress} />}
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

/** The step's state at a glance: a spinner while it runs, a tick once all is ready. */
function StateDisc({ progress }: { progress: StepProgress }) {
  if (progress.running > 0 || progress.queued > 0) {
    return (
      <Disc data-state="running" aria-hidden="true">
        <Spinner size={11} />
      </Disc>
    )
  }
  if (progress.jobs > 0 && progress.ready === progress.jobs) {
    return (
      <Disc data-state="done" aria-hidden="true">
        ✓
      </Disc>
    )
  }
  if (progress.failed > 0) {
    return (
      <Disc data-state="failed" aria-hidden="true">
        ×
      </Disc>
    )
  }
  return <Disc data-state="waiting" aria-hidden="true" />
}

const Disc = styled.span`
  display: inline-grid;
  place-items: center;
  width: ${icon.lg};
  height: ${icon.lg};
  border: 1.5px solid ${color.lineStrong};
  border-radius: ${radius.round};
  color: ${color.muted};
  font-size: ${typeVar.pill.size};
  &[data-state='running'] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
    color: ${color.accent};
  }
  &[data-state='done'] {
    border-color: ${color.ok};
    background: ${color.okWeak};
    color: ${color.ok};
  }
  &[data-state='failed'] {
    border-color: ${color.bad};
    background: ${color.badWeak};
    color: ${color.bad};
  }
`

const Page = styled.div`
  display: grid;
  gap: ${space[6]};
  min-width: 0;
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]} ${space[6]};
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
  gap: ${space[4]};
  min-width: 0;
`

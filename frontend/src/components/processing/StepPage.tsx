import type { ReactNode } from 'react'
import styled from 'styled-components'
import { sessionPageHref, batchHref } from '#/navigation/batch-route'
import type { ProcessingSource, WorkStep } from '#/processing/source'
import type { StepSummary } from '#/processing/lot-steps'
import { color, space, type } from '#/theme/generated/tokens'
import {
  linkTouchArea,
  onField,
  groundBehindOnField,
  PageStack,
  HelpButton,
  StatePill,
  type WorkState,
} from '#/components/ui'
import { Card, CardTitle, Muted, QuestionRows, SessionRows } from './ProcessingParts'

type Props = {
  batchId: string
  step: WorkStep
  source: ProcessingSource
  /** This step's own count and state, as its section below reads them. */
  summary: StepSummary
  /** The lot the address asks to focus, with its state at this step. */
  focus?: { label: string; state: WorkState; hasOutput: boolean }
  onOpenSession: (jobId: string) => void
  /** How the step works, behind a help button beside its heading. */
  help?: string
  /** The step's outputs: readings, sources, crops or matches. */
  children?: ReactNode
}

/**
 * Every step page has the same parts in the same places: its state, questions, sessions and
 * outputs. Values link to Review and evidence to Capture; the page never edits lots itself.
 */
export function StepPage({
  batchId,
  step,
  source,
  summary,
  focus,
  onOpenSession,
  help,
  children,
}: Props) {
  const progress = source.steps.find((item) => item.step === step)
  const questions = source.questions.filter((question) => question.step === step)
  const sessions = source.sessions.filter((session) => session.step === step)
  const label = progress?.label ?? step

  return (
    <Page>
      <Head>
        <StatePill state={summary.state} />
        <Title>{label}</Title>
        {help && <HelpButton label={`About ${label}`} explanation={help} />}
        <FieldNote>
          {[summary.text, sessionCount(sessions.length)].filter(Boolean).join(' · ')}
        </FieldNote>
        <CaptureLink href={batchHref(batchId, { tab: 'capture' })}>Evidence in Capture</CaptureLink>
      </Head>
      {focus && !focus.hasOutput && (
        <Focus aria-label={focus.label} data-focused-lot>
          <b>{focus.label}</b>
          <span>No {label} output for this lot yet</span>
          <StatePill state={focus.state} />
        </Focus>
      )}
      {questions.length > 0 && (
        <Card aria-label="Questions">
          <CardTitle>Questions</CardTitle>
          <QuestionRows batchId={batchId} questions={questions} />
        </Card>
      )}
      {sessions.length > 0 && (
        <Card aria-label="Sessions">
          <CardTitle>Sessions</CardTitle>
          <SessionRows
            sessions={sessions}
            paused={source.paused}
            onOpen={onOpenSession}
            pageHref={(session) => sessionPageHref(batchId, session.step, session.jobId)}
          />
        </Card>
      )}
      {children && <Outputs aria-label="Outputs">{children}</Outputs>}
    </Page>
  )
}

/** The step's own sessions, counted beside its lots; nothing when it has none. */
function sessionCount(count: number) {
  if (count === 0) {
    return ''
  }

  return count === 1 ? '1 session' : `${count} sessions`
}

const Page = styled(PageStack)``

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]} ${space[6]};
  a {
    margin-left: auto;
    color: ${color.accent};
    ${linkTouchArea}
  }
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
  ${onField}
`

/** The focused lot's entry while the step has no output for it, highlighted as its outputs are. */
const Focus = styled(Card)`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]} ${space[5]};
  border-color: ${color.accent};
  span {
    ${type.small}
    color: ${color.muted};
  }
`

const Outputs = styled.section`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
`

/** Text placed directly on the page, which takes a ground patch behind the whole window. */
const FieldNote = styled(Muted)`
  ${onField}
`

// A backing without the patch's margin, so the link keeps its place at the end of the row.
const CaptureLink = styled.a`
  ${groundBehindOnField}
`

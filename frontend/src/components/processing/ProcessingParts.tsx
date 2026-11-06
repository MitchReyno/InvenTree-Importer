import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type {
  PipelineCell,
  ProcessingSource,
  SourceQuestion,
  SourceSession,
  StepProgress,
} from '../../processing/source'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Pill, type PillTone } from '../ui/Pill'
import { Small } from '../ui/primitives'

export const STEP_LABEL: Record<string, string> = {
  examine: 'Examine',
  research: 'Research',
  images: 'Images',
  inventory: 'Inventory',
}

export const SESSION_STATE: Record<SourceSession['state'], { word: string; tone: PillTone }> = {
  queued: { word: 'Queued', tone: 'neutral' },
  running: { word: 'Running', tone: 'info' },
  waiting_input: { word: 'Waiting for you', tone: 'warn' },
  waiting_for_login: { word: 'Waiting for sign-in', tone: 'warn' },
  waiting_for_capacity: { word: 'Waiting for a slot', tone: 'neutral' },
  finished: { word: 'Finished', tone: 'ok' },
  cancelling: { word: 'Cancelling', tone: 'neutral' },
  cancelled: { word: 'Cancelled', tone: 'neutral' },
  interrupted: { word: 'Interrupted', tone: 'bad' },
  resume_unavailable: { word: 'Cannot resume', tone: 'bad' },
  failed: { word: 'Failed', tone: 'bad' },
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

/** A step's retained state in words; never a single percentage. */
export function stepOutcome(step: StepProgress) {
  if (step.jobs === 0) {
    return 'No work yet'
  }
  const parts = [
    step.ready && `${step.ready} ready`,
    step.running && `${step.running} running`,
    step.queued && `${step.queued} queued`,
    step.waiting && `${step.waiting} waiting`,
    step.failed && `${step.failed} failed`,
    step.questions && plural(step.questions, 'question'),
  ].filter(Boolean)

  return parts.length ? parts.join(' · ') : plural(step.jobs, 'attempt')
}

export function SessionRows({
  sessions,
  onOpen,
}: {
  sessions: SourceSession[]
  onOpen: (jobId: string) => void
}) {
  return (
    <Rows>
      {sessions.map((session) => (
        <li key={session.jobId}>
          <SessionLabel>
            <span>
              {STEP_LABEL[session.step]} · {session.subject}
            </span>
            {session.status && <Small>{session.status}</Small>}
          </SessionLabel>
          <Pill tone={SESSION_STATE[session.state].tone}>{SESSION_STATE[session.state].word}</Pill>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Open session: ${STEP_LABEL[session.step]} · ${session.subject}`}
            onClick={() => onOpen(session.jobId)}
          >
            Open session
          </Button>
        </li>
      ))}
    </Rows>
  )
}

export function QuestionRows({
  batchId,
  questions,
}: {
  batchId: string
  questions: SourceQuestion[]
}) {
  return (
    <Rows>
      {questions.map((question) => (
        <li key={question.id}>
          <span>
            <a
              href={batchHref(batchId, {
                tab: 'processing',
                step: question.step,
                questionId: question.id,
              })}
            >
              {question.prompt}
            </a>
            <Muted>
              {STEP_LABEL[question.step]} · {question.subject}
              {question.assumption && ` · ${question.assumption}`}
            </Muted>
          </span>
          {question.lotId && (
            <a
              aria-label={`Open in Review: ${question.subject}`}
              href={batchHref(batchId, { tab: 'review', view: 'lots', lotId: question.lotId })}
            >
              Open in Review
            </a>
          )}
        </li>
      ))}
    </Rows>
  )
}

export const Card = styled.section`
  display: grid;
  gap: ${space[2]};
  min-width: 0;
  padding: ${space['3-5']} ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

export const CardTitle = styled.h2`
  margin: 0;
  ${type.h2}
`

export const Muted = styled.span`
  font-size: 12.5px;
  color: ${color.muted};
`

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[2]};
    padding: ${space[2]} 0;
    border-top: 1px solid ${color.line};
  }
  li:first-child {
    border-top: 0;
  }
  li > :first-child {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  a {
    color: ${color.fg};
    font-weight: 600;
  }
`

/** A Processing job's state in words for the pipeline. */
export const JOB_STATE: Record<string, { word: string; tone: PillTone }> = {
  queued: { word: 'Queued', tone: 'neutral' },
  running: { word: 'Running', tone: 'info' },
  waiting_for_user: { word: 'Waiting for you', tone: 'warn' },
  waiting_for_login: { word: 'Waiting for sign-in', tone: 'warn' },
  waiting_for_capacity: { word: 'Waiting for a slot', tone: 'neutral' },
  ready: { word: 'Ready', tone: 'ok' },
  failed: { word: 'Failed', tone: 'bad' },
  cancelled: { word: 'Cancelled', tone: 'neutral' },
  superseded: { word: 'Waiting for identity', tone: 'neutral' },
  interrupted: { word: 'Interrupted', tone: 'bad' },
}

function PipelineStep({ label, cell }: { label: string; cell: PipelineCell }) {
  const state = cell ? (JOB_STATE[cell.state] ?? { word: cell.state, tone: 'neutral' }) : null
  return (
    <Step role="group" aria-label={`${label}: ${state?.word ?? 'Not started'}`}>
      <span>{label}</span>
      {state ? (
        <Pill tone={state.tone}>{state.word}</Pill>
      ) : (
        <Pill tone="outline" glyph="">
          Not started
        </Pill>
      )}
      {cell && cell.stale > 0 && <Pill tone="warn">{plural(cell.stale, 'stale result')}</Pill>}
      {cell && cell.provisional > 0 && <Pill tone="neutral">{cell.provisional} provisional</Pill>}
    </Step>
  )
}

/**
 * The batch's Examine lead session, then each lot's Research ∥ Images → Inventory. Research and
 * Images start together once the lot's identity is stable; Inventory waits for both.
 */
export function PipelineRows({ pipeline }: { pipeline: ProcessingSource['pipeline'] }) {
  const lead = pipeline.lead ? (JOB_STATE[pipeline.lead.state] ?? null) : null
  return (
    <Pipeline>
      {pipeline.lead && (
        <li aria-label="Examine · Whole batch">
          <strong>Examine · Whole batch</strong>
          {lead && <Pill tone={lead.tone}>{lead.word}</Pill>}
        </li>
      )}
      {pipeline.lots.map((lot) => (
        <li key={lot.lotId} aria-label={`Pipeline for ${lot.label}`}>
          <strong>{lot.label}</strong>
          <Lanes>
            <PipelineStep label="Research" cell={lot.cells.research} />
            <Parallel aria-hidden>∥</Parallel>
            <PipelineStep label="Images" cell={lot.cells.images} />
            <Parallel aria-hidden>→</Parallel>
            <PipelineStep label="Inventory" cell={lot.cells.inventory} />
          </Lanes>
        </li>
      ))}
    </Pipeline>
  )
}

const Pipeline = styled.ul`
  display: grid;
  gap: ${space[2]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: grid;
    justify-items: start;
    gap: ${space[1]};
    padding: ${space[2]} 0;
    border-top: 1px solid ${color.line};
  }
  li:first-child {
    border-top: 0;
  }
`

const Lanes = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[1]} ${space[2]};
`

const Step = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[1]};
  font-size: 13px;
  > span:first-child {
    color: ${color.muted};
  }
`

const Parallel = styled.span`
  color: ${color.muted};
  @media (max-width: 480px) {
    display: none;
  }
`

const SessionLabel = styled.span`
  display: grid;
  gap: 2px;
  min-width: 0;
`

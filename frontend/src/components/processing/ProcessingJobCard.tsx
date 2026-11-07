import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, typeVar } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, ProcessingJobDto } from '@invimport/contracts'
import { Heading, Paragraph, Panel, Small } from '../ui/primitives'
import { Button } from '../ui/Button'
import { ProcessingSources } from './ProcessingSources'
import { Pill } from '../ui/Pill'

type Job = ProcessingJobDto

const labels: Record<Job['state'], string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_for_user: 'Needs your answer',
  waiting_for_login: 'Waiting for provider sign-in',
  waiting_for_capacity: 'Waiting for subscription capacity',
  ready: 'Ready for human review',
  failed: 'Failed',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
  interrupted: 'Interrupted — start a new attempt',
}

/** Why a candidate stopped being current, in the operator's terms. */
const STALE_REASON: Record<
  Extract<NonNullable<Job['proposals'][number]['currentness']>, { state: 'stale' }>['reason'],
  string
> = {
  answer_received: 'an answer changed what it relied on',
  operator_correction: 'you corrected what it relied on',
  evidence_removed: 'evidence it cited left the lot',
  lot_regrouped: 'the lot was regrouped',
  source_superseded: 'a source it relied on changed',
  subject_retired: 'the lot was retired',
}

const blockerLabels: Record<NonNullable<Job['blocked_code']>, string> = {
  media_not_ready:
    'Relevant media is still being prepared. This retained input is no longer current.',
  media_input_capacity:
    'Relevant media exceeds the supported input limit. Reduce the selected evidence scope before starting a new attempt.',
  worker_version_conflict:
    'This retained attempt uses an older fixture version. Start a new attempt to continue.',
}

export function ProcessingJobCard({
  job,
  batch,
  disabled,
  cancel,
  chooseQuestion,
  session,
}: {
  job: Job
  batch: CaptureSnapshotDto
  disabled: boolean
  cancel: () => void
  chooseQuestion: (questionId: string) => void
  /** The session's steps and chat, for session profiles. */
  session?: ReactNode
}) {
  const subject = [...batch.lots, ...batch.parts].find((value) => value.id === job.subject_id)
  const cancellable =
    job.can_cancel ??
    [
      'queued',
      'running',
      'waiting_for_user',
      'waiting_for_login',
      'waiting_for_capacity',
      'interrupted',
    ].includes(job.state)
  return (
    <Panel>
      <Row>
        <Heading>
          {job.subject_id === null ? 'Whole batch' : (subject?.label ?? 'Retained subject')} ·{' '}
          {job.stage}
        </Heading>
        <Status>{labels[job.state]}</Status>
      </Row>
      <Small>
        Attempt {job.attempt_number} ·{' '}
        {job.qualification === 'fixture_only'
          ? 'synthetic fixture only'
          : 'native agent · live provider not qualified'}
      </Small>
      {job.blocked_code && <Paragraph role="status">{blockerLabels[job.blocked_code]}</Paragraph>}
      {job.proposals.map((proposal) => (
        <div key={proposal.id}>
          <Paragraph>
            <strong>Candidate:</strong> {proposal.value.summary}{' '}
            {proposal.currentness?.state === 'stale' && (
              <Pill tone="warn">Stale · {STALE_REASON[proposal.currentness.reason]}</Pill>
            )}
            {proposal.currentness?.state === 'provisional' && (
              <Pill tone="neutral">Provisional · a question is open</Pill>
            )}
            <Small>Candidate assertions do not replace your selections.</Small>
          </Paragraph>
          <ProcessingSources proposal={proposal.value} />
        </div>
      ))}
      {job.questions
        .filter((question) => question.state === 'open')
        .map((question) => (
          <Paragraph key={question.id}>
            {question.spec.prompt}
            {question.assumption && <Small>Continuing on: {question.assumption}</Small>}
          </Paragraph>
        ))}
      {session}
      <Actions>
        {job.questions
          .filter((question) => question.state === 'open')
          .map((question) => (
            <Button
              key={question.id}
              disabled={disabled}
              onClick={() => chooseQuestion(question.id)}
            >
              Open this question
            </Button>
          ))}
        {cancellable && (
          <Button disabled={disabled} onClick={cancel}>
            Cancel this attempt
          </Button>
        )}
      </Actions>
    </Panel>
  )
}

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space[8]};
  flex-wrap: wrap;
`

const Status = styled.span`
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
  color: ${color.muted};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
  &:empty {
    display: none;
  }
`

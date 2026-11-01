import styled from 'styled-components'
import type { CaptureSnapshotDto, ProcessingJobDto } from '@invimport/contracts'
import { Button, Heading, Paragraph, Panel, Small } from '../ui/primitives'

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

export function ProcessingJobCard({
  job,
  batch,
  disabled,
  cancel,
  chooseQuestion,
}: {
  job: Job
  batch: CaptureSnapshotDto
  disabled: boolean
  cancel: () => void
  chooseQuestion: (questionId: string) => void
}) {
  const subject = [...batch.lots, ...batch.parts].find((value) => value.id === job.subject_id)
  const cancellable = [
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
          {subject?.label ?? 'Retained subject'} · {job.stage}
        </Heading>
        <Status>{labels[job.state]}</Status>
      </Row>
      <Small>Attempt {job.attempt_number} · synthetic fixture only</Small>
      {job.proposals.map((proposal) => (
        <Paragraph key={proposal.id}>
          <strong>Candidate:</strong> {proposal.value.summary}
          <Small>Candidate assertions do not replace your selections.</Small>
        </Paragraph>
      ))}
      {job.questions
        .filter((question) => question.state === 'open')
        .map((question) => (
          <Paragraph key={question.id}>
            {question.spec.prompt}
            <br />
            <Button disabled={disabled} onClick={() => chooseQuestion(question.id)}>
              Open this question
            </Button>
          </Paragraph>
        ))}
      {cancellable && (
        <Button disabled={disabled} onClick={cancel}>
          Cancel this attempt
        </Button>
      )}
    </Panel>
  )
}

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
`

const Status = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: #526179;
`

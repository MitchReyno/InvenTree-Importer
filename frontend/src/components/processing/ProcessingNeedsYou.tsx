import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { Heading, Panel, Small } from '../ui/primitives'

interface Props {
  batch: CaptureSnapshotDto
  snapshot: ProcessingSnapshotDto
}

function subjectLabel(batch: CaptureSnapshotDto, id: string) {
  const subject = [...batch.lots, ...batch.parts].find((value) => value.id === id)
  return subject?.label ?? 'Retained subject'
}

/** Open questions first: each chip opens that exact question; lots also link to Review. */
export function ProcessingNeedsYou({ batch, snapshot }: Props) {
  const open = snapshot.jobs.flatMap((job) =>
    job.questions
      .filter((question) => question.state === 'open')
      .map((question) => ({ job, question })),
  )
  const ready = snapshot.jobs.filter((job) => job.state === 'ready').length
  return (
    <Panel aria-label="Needs you">
      <Heading>
        {open.length
          ? `${open.length} need${open.length === 1 ? 's' : ''} you`
          : 'Nothing needs you'}
      </Heading>
      <Small>
        {ready} fixture-only result{ready === 1 ? '' : 's'} ready. Review shows them as candidates,
        never as chosen values.
      </Small>
      {open.length > 0 && (
        <Chips>
          {open.map(({ job, question }) => {
            const isLot = batch.lots.some((lot) => lot.id === question.spec.subject_id)
            return (
              <li key={question.id}>
                <a href={`#${batch.id}/processing/${job.stage}/${question.id}`}>
                  {subjectLabel(batch, question.spec.subject_id)} · {job.stage}
                </a>
                {question.assumption && <Small>Assuming: {question.assumption}</Small>}
                {isLot && (
                  <a href={`#${batch.id}/review/${question.spec.subject_id}`}>Open in Review</a>
                )}
              </li>
            )
          })}
        </Chips>
      )}
    </Panel>
  )
}

const Chips = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 10px 0 0;
  list-style: none;
  li {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 12px;
    border: 1px solid ${color.warn};
    background: ${color.warnWeak};
    border-radius: 999px;
  }
  a {
    color: ${color.accent};
    min-height: 32px;
    display: inline-flex;
    align-items: center;
  }
`

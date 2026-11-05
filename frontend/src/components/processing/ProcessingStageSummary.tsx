import type { ProcessingSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import { Small } from '../ui/primitives'

const stages = ['reading', 'identifying', 'research', 'images', 'inventory'] as const

export function ProcessingStageSummary({
  batchId,
  snapshot,
}: {
  batchId: string
  snapshot: ProcessingSnapshotDto
}) {
  return (
    <Stages aria-label="Processing stage overview">
      {stages.map((stage) => {
        const jobs = snapshot.jobs.filter((job) => job.stage === stage)
        const questions = jobs
          .flatMap((job) => job.questions)
          .filter((question) => question.state === 'open').length
        const ready = jobs.filter((job) => job.state === 'ready').length
        return (
          <a key={stage} href={`#${batchId}/processing/${stage}`}>
            <strong>{stage[0].toUpperCase() + stage.slice(1)}</strong>
            <Small>
              {jobs.length} saved jobs · {ready} ready
            </Small>
            <Small>{questions ? `${questions} open questions` : 'No open questions'}</Small>
          </a>
        )
      })}
    </Stages>
  )
}

const Stages = styled.nav`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  a {
    padding: 14px;
    border: 1px solid ${color.line};
    border-radius: 6px;
    background: ${color.surface};
    color: ${color.accent};
    text-decoration: none;
  }
`

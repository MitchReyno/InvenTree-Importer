import styled from 'styled-components'
import type { SessionHistoryDetailsDto } from '@invimport/contracts'
import { SourceChip } from '#/components/ui'
import { evidenceWords } from '#/operator/value-evidence'
import { observationCrop } from '#/media/types'
import { space } from '#/theme/generated/tokens'
import { EntryCrop } from './history-styles'

type CurrentObservation = NonNullable<
  Extract<SessionHistoryDetailsDto, { kind: 'observation' }>['current']
>

/** An observation's crop, its reading with the source chip, and how many were visible. */
export function ObservationReading({
  observation,
  batchId,
}: {
  observation: CurrentObservation
  batchId: string
}) {
  const said = evidenceWords(observation.readings)
  const reading = observation.readings.text ?? observation.readings.markings.join(' · ')
  return (
    <Observation>
      <EntryCrop
        src={observationCrop(batchId, observation.id)}
        alt={`Crop of the observation: ${reading}`}
        loading="lazy"
      />
      <span>
        {reading}{' '}
        <SourceChip
          source={said.kind ? `Examine · ${said.kind}` : 'Examine'}
          certainty={said.certainty ?? 'Read from the photo'}
          tone={said.tone}
          value={reading}
          why="What the agent read in this region."
        />
        {observation.visible_count !== null && ` · ${observation.visible_count} visible`}
      </span>
    </Observation>
  )
}

const Observation = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  overflow-wrap: anywhere;
`

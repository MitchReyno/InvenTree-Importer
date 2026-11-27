import type { SessionHistoryDetailsDto } from '@invimport/contracts'
import { DetailLabel, DetailList } from './history-styles'
import { ObservationReading } from './ObservationReading'

type Details = Extract<SessionHistoryDetailsDto, { kind: 'lot' }>

/** A formed or extended lot as it is now: its estimate, selected quantity, observations and reason. */
export function LotDetails({ details, batchId }: { details: Details; batchId: string }) {
  const { lot } = details
  return (
    <>
      <DetailLabel>Current values</DetailLabel>
      {lot?.estimate && (
        <p>
          Agent’s estimate: {lot.estimate.quantity} · estimated — {lot.estimate.basis}
        </p>
      )}
      {lot?.selected_quantity.mode === 'set' && (
        <p>Selected quantity: {lot.selected_quantity.value}</p>
      )}
      {lot && lot.observations.length > 0 && (
        <DetailList>
          {lot.observations.map((observation) => (
            <li key={observation.id}>
              <ObservationReading observation={observation} batchId={batchId} />
            </li>
          ))}
        </DetailList>
      )}
      <p>
        {details.separation_reason
          ? `Kept apart: ${details.separation_reason}`
          : 'Why it is kept apart was not recorded.'}
      </p>
    </>
  )
}

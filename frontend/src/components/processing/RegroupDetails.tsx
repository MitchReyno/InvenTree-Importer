import type { SessionHistoryDetailsDto, SessionHistoryEntryDto } from '@invimport/contracts'
import { DebugDetails } from '#/components/ui'
import { DetailList } from './history-styles'
import { HistoryLink } from './HistoryLinks'
import type { HistoryContext } from './HistoryLinks'

type Details = Extract<SessionHistoryDetailsDto, { kind: 'regroup' }>

const OUTCOME = {
  applied: 'moved',
  suggested: 'only suggested, since you edited it',
  unchanged: 'already there',
}

/**
 * Each observation a regroup moved, numbered in the order the agent gave them, with where it came
 * from, where it went and whether that was applied; an older regroup kept only its destinations.
 */
export function RegroupDetails({
  entry,
  details,
  context,
}: {
  entry: SessionHistoryEntryDto
  details: Details
  context: HistoryContext
}) {
  const labels = new Map(
    entry.links.flatMap((link) =>
      link.kind === 'lot' ? [[link.lot_id, link.label] as const] : [],
    ),
  )

  const name = (id: string | null) => (id ? (labels.get(id) ?? 'a lot') : 'no lot')

  if (!details.moves) {
    return <p>Moved into {details.lot_ids.map(name).join(', ')}</p>
  }
  return (
    <>
      <DetailList>
        {details.moves.map((move, index) => (
          <li key={`${move.observation_id}:${move.to_lot_id}`}>
            Observation {index + 1}: from {name(move.from_lot_id)} to {name(move.to_lot_id)},{' '}
            {OUTCOME[move.outcome]}{' '}
            <HistoryLink
              link={{ kind: 'map', observation_id: move.observation_id }}
              context={context}
            />
          </li>
        ))}
      </DetailList>
      <DebugDetails
        label="Regrouped observations"
        rows={details.moves.map((move, index) => ({
          key: `${move.observation_id}:${move.to_lot_id}`,
          label: `Observation ${index + 1}`,
          value: move.observation_id,
        }))}
      />
    </>
  )
}

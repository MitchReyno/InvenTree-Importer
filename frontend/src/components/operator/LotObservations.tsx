import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { observationCrop } from '../../media/types'
import { Button, Field, Small, Subheading } from '../ui/primitives'
import { StatusChip } from './StatusChip'

type Lot = CaptureSnapshotDto['lots'][number]
type Observation = NonNullable<CaptureSnapshotDto['evidence_observations']>[number]

interface Props {
  batch: CaptureSnapshotDto
  lot: Lot
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
  disabled: boolean
}

function Reading({ observation }: { observation: Observation }) {
  const markings = observation.readings.markings.join(' · ')
  return (
    <span>
      {markings || 'No markings read'}
      {observation.visible_count !== null && <> · {observation.visible_count} visible</>}
      {observation.region.kind === 'lines' && (
        <>
          {' '}
          · lines {observation.region.from_line}–{observation.region.to_line}
        </>
      )}
    </span>
  )
}

/**
 * The observations a lot is formed from, as crops of their regions, and the lead session's
 * suggestions for it. Accepting or dismissing a suggestion is the operator's own edit.
 */
export function LotObservations({ batch, lot, edit, disabled }: Props) {
  const observations = batch.evidence_observations ?? []
  const members = observations.filter((observation) => observation.lot_id === lot.id)
  const suggested = observations.filter((observation) =>
    observation.suggested_lot_ids.includes(lot.id),
  )
  if (!members.length && !suggested.length) {
    return null
  }

  const crop = (observation: Observation) =>
    observation.region.kind === 'pixels' ? (
      <Crop src={observationCrop(batch.id, observation.id)} alt="" />
    ) : null

  return (
    <section aria-label="Observations">
      <Subheading>
        Observations{' '}
        {lot.origin === 'agent' &&
          (lot.operator_edited ? (
            <StatusChip $tone="neutral">Edited</StatusChip>
          ) : (
            <StatusChip $tone="blue">AI-proposed</StatusChip>
          ))}
      </Subheading>
      {lot.estimated_quantity && (
        <Small>
          Estimated {lot.estimated_quantity} · {lot.quantity_basis}. An estimate, not a chosen
          quantity.
        </Small>
      )}
      <List>
        {members.map((observation) => (
          <li key={observation.id}>
            {crop(observation)}
            <Reading observation={observation} />
            {observation.operator_edited && <StatusChip $tone="neutral">Edited</StatusChip>}
          </li>
        ))}
      </List>
      {suggested.length > 0 && (
        <Field>
          <strong>Suggested by the Examine session</strong>
          <List>
            {suggested.map((observation) => (
              <li key={observation.id} aria-label="Suggested observation">
                {crop(observation)}
                <Reading observation={observation} />
                <Button
                  type="button"
                  disabled={disabled || !edit}
                  onClick={() =>
                    void edit?.({
                      kind: 'observation_suggestion',
                      observation_id: observation.id,
                      lot_id: lot.id,
                      decision: 'accept',
                    })
                  }
                >
                  Add to this lot
                </Button>
                <Button
                  type="button"
                  disabled={disabled || !edit}
                  onClick={() =>
                    void edit?.({
                      kind: 'observation_suggestion',
                      observation_id: observation.id,
                      lot_id: lot.id,
                      decision: 'dismiss',
                    })
                  }
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </List>
        </Field>
      )}
    </section>
  )
}

const List = styled.ul`
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
`

const Crop = styled.img`
  width: 64px;
  height: 64px;
  object-fit: cover;
  border: 1px solid currentColor;
  border-radius: 4px;
`

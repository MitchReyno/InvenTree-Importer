import styled from 'styled-components'
import { space } from '../../theme/generated/tokens'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { coverSizes, observationImage } from '../../media/images'
import { Field, Small, Subheading } from '../ui/primitives'
import { Button } from '../ui/Button'
import { Pill } from '../ui/Pill'
import { ObservationMove } from './ObservationMove'
import { observationNames } from './observation-names'

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
  const active = members.filter((observation) => observation.status === 'active')

  // Suggested revisions of this lot's observations the operator has edited.
  const revisions = observations.filter(
    (observation) =>
      observation.status === 'suggested' &&
      members.some((member) => member.id === observation.supersedes_observation_id),
  )

  const names = observationNames(observations)

  const describe = (observation: Observation) => names.get(observation.id) ?? 'unread item'

  const crop = (observation: Observation) =>
    observation.region.kind === 'pixels' ? (
      <Crop
        {...observationImage(
          batch.id,
          { ...observation, region: observation.region },
          'thumbnail',
          coverSizes({ width: 64, height: 64 }, observation.region),
        )}
        loading="lazy"
        decoding="async"
        alt={`Region: ${describe(observation)}`}
      />
    ) : null

  const decide = (observation: Observation, decision: 'accept' | 'dismiss', lotId?: string) =>
    void edit?.({
      kind: 'observation_suggestion',
      observation_id: observation.id,
      ...(lotId ? { lot_id: lotId } : {}),
      decision,
    })

  return (
    <section aria-label="Observations">
      <Subheading>
        Observations{' '}
        {lot.origin === 'agent' &&
          (lot.operator_edited ? (
            <Pill tone="neutral">Edited</Pill>
          ) : (
            <Pill tone="acc">AI-proposed</Pill>
          ))}
      </Subheading>
      {lot.estimated_quantity && (
        <Small>
          Estimated {lot.estimated_quantity} · {lot.quantity_basis}. An estimate, not a chosen
          quantity.
        </Small>
      )}
      <List>
        {active.map((observation) => (
          <li key={observation.id}>
            {crop(observation)}
            <Reading observation={observation} />
            {observation.operator_edited && <Pill tone="neutral">Edited</Pill>}
            <ObservationMove
              batch={batch}
              observationId={observation.id}
              lotId={lot.id}
              name={describe(observation)}
              edit={edit}
              disabled={disabled}
            />
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
                  aria-label={`Add ${describe(observation)} to ${lot.label}`}
                  disabled={disabled || !edit}
                  onClick={() => decide(observation, 'accept', lot.id)}
                >
                  Add to this lot
                </Button>
                <Button
                  type="button"
                  aria-label={`Dismiss ${describe(observation)} for ${lot.label}`}
                  disabled={disabled || !edit}
                  onClick={() => decide(observation, 'dismiss', lot.id)}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </List>
        </Field>
      )}
      {revisions.length > 0 && (
        <Field>
          <strong>Suggested revisions of your observations</strong>
          <List>
            {revisions.map((observation) => (
              <li key={observation.id} aria-label="Suggested revision">
                {crop(observation)}
                <Reading observation={observation} />
                <Button
                  type="button"
                  aria-label={`Use the suggested revision: ${describe(observation)}`}
                  disabled={disabled || !edit}
                  onClick={() => decide(observation, 'accept')}
                >
                  Use this revision
                </Button>
                <Button
                  type="button"
                  aria-label={`Dismiss the suggested revision: ${describe(observation)}`}
                  disabled={disabled || !edit}
                  onClick={() => decide(observation, 'dismiss')}
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
  gap: ${space[3]};
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[4]};
  }
`

const Crop = styled.img`
  width: 64px;
  height: 64px;
  object-fit: cover;
  border: 1px solid currentColor;
  border-radius: 4px;
`

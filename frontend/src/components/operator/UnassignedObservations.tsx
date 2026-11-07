import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { coverSizes, observationImage } from '../../media/images'
import { Field, Small, Subheading } from '../ui/primitives'
import { Button } from '../ui/Button'
import { ObservationMove } from './ObservationMove'
import { observationNames } from './observation-names'

type Observation = NonNullable<CaptureSnapshotDto['evidence_observations']>[number]

interface Props {
  batch: CaptureSnapshotDto
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
  disabled: boolean
}

/**
 * Observations in no lot, with the lead session's suggestions for them: lots it would add them
 * to, and revisions of the ones the operator edited. Each decision is the operator's own edit.
 */
export function UnassignedObservations({ batch, edit, disabled }: Props) {
  const observations = batch.evidence_observations ?? []
  const lots = new Map(batch.lots.filter((lot) => !lot.retired).map((lot) => [lot.id, lot.label]))
  // Also those left on a lot the operator split, merged or retired.
  const unassigned = observations.filter(
    (o) => o.status === 'active' && (o.lot_id === null || !lots.has(o.lot_id)),
  )
  if (!unassigned.length) {
    return null
  }

  const names = observationNames(observations)

  const describe = (o: Observation) => names.get(o.id) ?? 'unread item'

  const decide = (change: Extract<CaptureEditDto['change'], { kind: 'observation_suggestion' }>) =>
    void edit?.(change)

  return (
    <section aria-label="Unassigned observations">
      <Subheading>Unassigned observations</Subheading>
      <Small>Items the Examine session or you recorded that are in no live lot.</Small>
      <List>
        {unassigned.map((observation) => {
          const revisions = observations.filter(
            (o) => o.status === 'suggested' && o.supersedes_observation_id === observation.id,
          )
          const targets = observation.suggested_lot_ids.filter((id) => lots.has(id))
          return (
            <li key={observation.id}>
              {observation.region.kind === 'pixels' && (
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
              )}
              <span>{describe(observation)}</span>
              <ObservationMove
                batch={batch}
                observationId={observation.id}
                lotId={null}
                name={describe(observation)}
                edit={edit}
                disabled={disabled}
              />
              {targets.map((lotId) => (
                <Field key={lotId}>
                  <Button
                    type="button"
                    aria-label={`Add ${describe(observation)} to ${lots.get(lotId)}`}
                    disabled={disabled || !edit}
                    onClick={() =>
                      decide({
                        kind: 'observation_suggestion',
                        observation_id: observation.id,
                        lot_id: lotId,
                        decision: 'accept',
                      })
                    }
                  >
                    Add to {lots.get(lotId)}
                  </Button>
                  <Button
                    type="button"
                    aria-label={`Dismiss ${describe(observation)} for ${lots.get(lotId)}`}
                    disabled={disabled || !edit}
                    onClick={() =>
                      decide({
                        kind: 'observation_suggestion',
                        observation_id: observation.id,
                        lot_id: lotId,
                        decision: 'dismiss',
                      })
                    }
                  >
                    Dismiss
                  </Button>
                </Field>
              ))}
              {revisions.map((revision) => (
                <Field key={revision.id}>
                  <Small>Suggested revision: {describe(revision)}</Small>
                  <Button
                    type="button"
                    aria-label={`Use the suggested revision: ${describe(revision)}`}
                    disabled={disabled || !edit}
                    onClick={() =>
                      decide({
                        kind: 'observation_suggestion',
                        observation_id: revision.id,
                        decision: 'accept',
                      })
                    }
                  >
                    Use this revision
                  </Button>
                  <Button
                    type="button"
                    aria-label={`Dismiss the suggested revision: ${describe(revision)}`}
                    disabled={disabled || !edit}
                    onClick={() =>
                      decide({
                        kind: 'observation_suggestion',
                        observation_id: revision.id,
                        decision: 'dismiss',
                      })
                    }
                  >
                    Dismiss
                  </Button>
                </Field>
              ))}
            </li>
          )
        })}
      </List>
    </section>
  )
}

const List = styled.ul`
  display: grid;
  gap: 8px;
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

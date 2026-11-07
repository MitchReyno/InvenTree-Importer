import styled from 'styled-components'
import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { coverSizes, observationImage } from '../../media/images'
import { batchHref } from '../../navigation/batch-route'
import { color, radius, space } from '../../theme/generated/tokens'
import { Pill } from '../ui/Pill'
import { Card, CardTitle, Muted } from './ProcessingParts'
import { ProcessingSources } from './ProcessingSources'

type Observation = NonNullable<CaptureSnapshotDto['evidence_observations']>[number]
type Job = ProcessingSnapshotDto['jobs'][number]

function region(observation: Observation) {
  const r = observation.region
  return r.kind === 'lines'
    ? `lines ${r.from_line}–${r.to_line}`
    : `region ${r.x},${r.y} · ${r.width}×${r.height}`
}

function readings(observation: Observation) {
  const markings = observation.readings.markings.join(' · ') || 'No markings read'
  return observation.visible_count === null
    ? markings
    : `${markings} · ${observation.visible_count} visible`
}

/**
 * What the Examine lead session found: every region it read in each photo with the lot it
 * belongs to, then each lot with its observations, candidates and quantity basis.
 */
export function ExamineView({ batch, lead }: { batch: CaptureSnapshotDto; lead: Job | undefined }) {
  const observations = (batch.evidence_observations ?? []).filter(
    (item) => item.status === 'active',
  )
  if (!observations.length) {
    return null
  }
  const lots = new Map(batch.lots.map((lot) => [lot.id, lot]))
  // Photos in the order their first observation was read.
  const photos = [...new Set(observations.map((item) => item.evidence_version_id))]
  const formed = batch.lots.filter(
    (lot) => !lot.retired && (lot.evidence_observation_ids?.length ?? 0) > 0,
  )

  const crop = (observation: Observation) =>
    observation.region.kind === 'pixels' ? (
      <Crop
        {...observationImage(
          batch.id,
          { ...observation, region: observation.region },
          'thumbnail',
          coverSizes({ width: 56, height: 56 }, observation.region),
        )}
        loading="lazy"
        decoding="async"
        alt={`Region: ${readings(observation)}`}
      />
    ) : null

  return (
    <>
      <Card aria-label="Regions by photo">
        <CardTitle>Regions by photo</CardTitle>
        {photos.map((version, index) => (
          <section key={version} aria-label={`Photo ${index + 1}`}>
            <Muted>Photo {index + 1}</Muted>
            <List>
              {observations
                .filter((item) => item.evidence_version_id === version)
                .map((observation) => {
                  const lot = observation.lot_id ? lots.get(observation.lot_id) : undefined
                  return (
                    <li key={observation.id}>
                      {crop(observation)}
                      <span>
                        {readings(observation)}
                        <Muted> · {region(observation)}</Muted>
                      </span>
                      {lot ? (
                        <a
                          href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id })}
                        >
                          {lot.label}
                        </a>
                      ) : (
                        <Pill tone="outline" glyph="">
                          No lot
                        </Pill>
                      )}
                    </li>
                  )
                })}
            </List>
          </section>
        ))}
      </Card>
      <Card aria-label="Lots formed">
        <CardTitle>Lots formed</CardTitle>
        {formed.map((lot) => {
          const candidates = (lead?.proposals ?? []).filter(
            (proposal) => proposal.value.subject_id === lot.id,
          )
          return (
            <LotBlock key={lot.id} aria-label={`Lot ${lot.label}`}>
              <strong>
                <a href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id })}>
                  {lot.label}
                </a>
              </strong>{' '}
              {lot.origin === 'agent' &&
                (lot.operator_edited ? (
                  <Pill tone="neutral">Edited</Pill>
                ) : (
                  <Pill tone="info">AI-proposed</Pill>
                ))}
              {lot.estimated_quantity && (
                <Muted>
                  Estimated {lot.estimated_quantity} · {lot.quantity_basis}
                </Muted>
              )}
              <List>
                {observations
                  .filter((item) => item.lot_id === lot.id)
                  .map((observation) => (
                    <li key={observation.id}>
                      {crop(observation)}
                      <span>{readings(observation)}</span>
                    </li>
                  ))}
              </List>
              {candidates.map((proposal) => (
                <Candidate key={proposal.id}>
                  <span>
                    <strong>Candidate:</strong> {proposal.value.summary}{' '}
                    {proposal.currentness?.state === 'stale' && <Pill tone="warn">Stale</Pill>}
                    {proposal.currentness?.state === 'provisional' && (
                      <Pill tone="neutral">Provisional</Pill>
                    )}
                  </span>
                  <ProcessingSources proposal={proposal.value} />
                </Candidate>
              ))}
            </LotBlock>
          )
        })}
      </Card>
    </>
  )
}

const List = styled.ul`
  display: grid;
  gap: ${space[2]};
  margin: ${space[2]} 0 ${space[4]};
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[4]};
    min-width: 0;
  }
  a {
    color: ${color.accent};
  }
`

const Crop = styled.img`
  width: 56px;
  height: 56px;
  object-fit: cover;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
`

const LotBlock = styled.section`
  display: grid;
  justify-items: start;
  gap: ${space[2]};
  padding: ${space[4]} 0;
  border-top: 1px solid ${color.line};
  &:first-of-type {
    border-top: 0;
  }
  a {
    color: ${color.fg};
  }
`

const Candidate = styled.div`
  display: grid;
  gap: ${space[2]};
`

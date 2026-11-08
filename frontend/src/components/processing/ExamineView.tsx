import { useState } from 'react'
import styled from 'styled-components'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  MediaSnapshotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { evidenceDisplayNames } from '../../media/identity-labels'
import { coverSizes, observationImage } from '../../media/images'
import { batchHref } from '../../navigation/batch-route'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Count, Pill } from '../ui/Pill'
import { SegmentedControl } from '../ui/SegmentedControl'
import { SourceChip } from '../ui/SourceChip'
import { Input, Label, linkTouchArea, Summary } from '../ui/primitives'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { RegionStage } from '../review/RegionStage'
import { Card, CardTitle, Muted, plural } from './ProcessingParts'
import { ProcessingSources } from './ProcessingSources'

type Observation = NonNullable<CaptureSnapshotDto['evidence_observations']>[number]
type Job = ProcessingSnapshotDto['jobs'][number]

/** Lots shown before "N more lots"; Review lists them all. */
const LOTS_SHOWN = 5

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

/** Who a reading comes from: the Examine step, or the operator who corrected it. */
function source(observation: Observation) {
  return observation.origin === 'operator' || observation.operator_edited
    ? { source: 'You', certainty: 'Your edit', tone: 'user' as const }
    : {
        source: 'Examine',
        // Line regions are a document's lines; pixel regions are part of a photo.
        certainty:
          observation.region.kind === 'lines' ? 'Read from the document' : 'Read from the photo',
        tone: 'default' as const,
      }
}

/** Each photo's file name and group, from the media snapshot when it has been read. */
function photoNames(media: MediaSnapshotDto | undefined) {
  const names = new Map<string, { name: string; group: string | null }>()
  if (!media) {
    return names
  }
  const display = evidenceDisplayNames(media.evidence)
  for (const item of media.evidence) {
    const group = media.groups.find((candidate) => candidate.id === item.group_id)?.label ?? null
    for (const version of item.versions) {
      names.set(version.id, { name: display.get(item.id) ?? item.label, group })
    }
  }
  return names
}

/**
 * What the Examine lead session found: every region it read in each photo with the lot it
 * belongs to, then each lot with its observations, candidates and quantity basis.
 */
/** A reading's markings, edited as a comma-separated list. */
function ReadingEdit({
  observation,
  save,
}: {
  observation: Observation
  save: (change: CaptureEditDto['change']) => Promise<unknown>
}) {
  const name = observation.readings.markings.join(' · ') || 'this region'
  const [value, setValue] = useState(observation.readings.markings.join(', '))
  const [saving, setSaving] = useState(false)
  return (
    <ReadingForm
      onSubmit={(event) => {
        event.preventDefault()
        setSaving(true)
        void save({
          kind: 'observation',
          observation_id: observation.id,
          evidence_version_id: observation.evidence_version_id,
          page: observation.page,
          region: observation.region,
          readings: {
            ...observation.readings,
            markings: value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean),
          },
        }).finally(() => setSaving(false))
      }}
    >
      <Label>
        <VisuallyHidden>Markings for {name}</VisuallyHidden>
        <Input value={value} disabled={saving} onChange={(event) => setValue(event.target.value)} />
      </Label>
      <Button size="sm" type="submit" disabled={saving} aria-label={`Save readings for ${name}`}>
        Save
      </Button>
    </ReadingForm>
  )
}

export function ExamineView({
  batch,
  lead,
  media,
  questionedLots = new Set(),
  edit,
  askSharper,
}: {
  batch: CaptureSnapshotDto
  lead: Job | undefined
  /** Names photos by file and group; without it they are numbered. */
  media?: MediaSnapshotDto
  /** Lots with an open question, which read "Question" rather than "Stable". */
  questionedLots?: ReadonlySet<string>
  /** Corrects a reading or region through the capture edit `kind: 'observation'`. */
  edit?: (change: CaptureEditDto['change']) => Promise<unknown>
  /** Asks the Examine lead session, through its chat, for a sharper photo of the named file. */
  askSharper?: (name: string) => Promise<void>
}) {
  const [lens, setLens] = useState<'photo' | 'lot'>('photo')
  const [editing, setEditing] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const observations = (batch.evidence_observations ?? []).filter(
    (item) => item.status === 'active',
  )
  if (!observations.length) {
    return null
  }
  const lots = new Map(batch.lots.map((lot) => [lot.id, lot]))
  // Photos in the order their first observation was read.
  const photos = [...new Set(observations.map((item) => item.evidence_version_id))]
  const names = photoNames(media)
  const formed = batch.lots.filter(
    (lot) => !lot.retired && (lot.evidence_observation_ids?.length ?? 0) > 0,
  )
  const capture = batchHref(batch.id, { tab: 'capture' })

  const evidenceOf = (version: string) =>
    media?.evidence.find((item) => item.versions?.some((value) => value.id === version))

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
      <Lens>
        <Muted>
          {plural(photos.length, 'file')} · {plural(observations.length, 'observation')} ·{' '}
          {plural(formed.length, 'lot')}
        </Muted>
        <SegmentedControl
          label="Examine lens"
          options={[
            { id: 'photo', label: 'By photo' },
            { id: 'lot', label: 'By lot' },
          ]}
          value={lens}
          onChange={(id) => setLens(id as 'photo' | 'lot')}
        />
      </Lens>
      {lens === 'photo' && (
        <Card aria-label="Regions by photo">
          <CardTitle>Regions by photo</CardTitle>
          {photos.map((version, index) => {
            const named = names.get(version)
            const shown = observations.filter((item) => item.evidence_version_id === version)
            // Retired predecessors keep observations but no longer count as lots fed.
            const fed = new Set(
              shown.flatMap((item) =>
                item.lot_id && lots.get(item.lot_id) && !lots.get(item.lot_id)!.retired
                  ? [item.lot_id]
                  : [],
              ),
            )
            return (
              <Photo key={version} aria-label={named?.name ?? `Photo ${index + 1}`}>
                <PhotoHead>
                  <b>{named?.name ?? `Photo ${index + 1}`}</b>
                  <Muted>
                    {/* Without the media read the group is unknown, so it is left out. */}
                    {named && `${named.group ?? 'Not in a group'} · `}
                    {plural(shown.length, 'observation')} · feeds {plural(fed.size, 'lot')}
                  </Muted>
                  <Button as="a" size="sm" variant="ghost" href={capture}>
                    Evidence in Capture
                  </Button>
                  {edit && (
                    <>
                      <Button
                        size="sm"
                        aria-pressed={editing === version}
                        onClick={() => setEditing(editing === version ? null : version)}
                      >
                        Edit readings
                      </Button>
                      {evidenceOf(version) && (
                        <Button
                          size="sm"
                          aria-pressed={adjusting === version}
                          onClick={() => setAdjusting(adjusting === version ? null : version)}
                        >
                          Adjust regions
                        </Button>
                      )}
                    </>
                  )}
                  {askSharper && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void askSharper(named?.name ?? `Photo ${index + 1}`)}
                    >
                      Ask for a sharper photo
                    </Button>
                  )}
                </PhotoHead>
                {edit && adjusting === version && evidenceOf(version) && (
                  <RegionStage
                    batchId={batch.id}
                    evidence={evidenceOf(version)!}
                    label={named?.name ?? `Photo ${index + 1}`}
                    observations={observations}
                    disabled={false}
                    save={edit}
                  />
                )}
                <List>
                  {shown.map((observation) => {
                    const lot = observation.lot_id ? lots.get(observation.lot_id) : undefined
                    const chip = source(observation)
                    return (
                      <li key={observation.id}>
                        {crop(observation)}
                        <Reading>
                          <span>{readings(observation)}</span>
                          {observation.operator_edited && observation.origin !== 'operator' && (
                            <Pill status="edited">Corrected by you</Pill>
                          )}
                          {edit && editing === version && (
                            <ReadingEdit observation={observation} save={edit} />
                          )}
                          <SourceChip
                            source={chip.source}
                            certainty={chip.certainty}
                            tone={chip.tone}
                            onOpen={() => {
                              location.hash = capture
                            }}
                          />
                          <details>
                            <Summary>Details</Summary>
                            <Muted>{region(observation)}</Muted>
                          </details>
                        </Reading>
                        {lot ? (
                          <a
                            href={batchHref(batch.id, {
                              tab: 'review',
                              view: 'lots',
                              lotId: lot.id,
                            })}
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
              </Photo>
            )
          })}
        </Card>
      )}
      <Card aria-label="Lots formed">
        <FormedHead>
          <CardTitle>Lots formed</CardTitle>
          <Count value={formed.length} />
          <Muted>Edit lots in Review › Map</Muted>
          <Button as="a" size="sm" href={batchHref(batch.id, { tab: 'review', view: 'map' })}>
            Open the map
          </Button>
        </FormedHead>
        {formed.slice(0, LOTS_SHOWN).map((lot) => {
          const candidates = (lead?.proposals ?? []).filter(
            (proposal) => proposal.value.subject_id === lot.id,
          )
          const members = observations.filter((item) => item.lot_id === lot.id)
          return (
            <LotBlock key={lot.id} aria-label={`Lot ${lot.label}`}>
              <LotHead>
                <strong>
                  <a href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id })}>
                    {lot.label}
                  </a>
                </strong>
                <Muted>
                  {plural(members.length, 'observation')}
                  {members.length > 0 &&
                    `: ${members
                      .map((item) => names.get(item.evidence_version_id)?.name ?? readings(item))
                      .join(', ')}`}
                </Muted>
                <Pills>
                  {lot.origin === 'agent' &&
                    (lot.operator_edited ? (
                      <Pill tone="neutral">Edited</Pill>
                    ) : (
                      <Pill tone="acc" glyph="✦">
                        AI-proposed
                      </Pill>
                    ))}
                  {lot.reexamine && <Pill status="warning">Re-examine</Pill>}
                  {questionedLots.has(lot.id) ? (
                    <Pill status="needs-answer">Question</Pill>
                  ) : (
                    <Pill tone="ok">Stable</Pill>
                  )}
                </Pills>
              </LotHead>
              {lot.estimated_quantity && (
                <Muted>
                  Estimated {lot.estimated_quantity} · {lot.quantity_basis}
                </Muted>
              )}
              <List>
                {members.map((observation) => (
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
        {formed.length > LOTS_SHOWN && (
          <Muted>{plural(formed.length - LOTS_SHOWN, 'more lot')}</Muted>
        )}
      </Card>
    </>
  )
}

const Lens = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
`

const Photo = styled.section`
  display: grid;
  gap: ${space[3]};
  padding: ${space[4]} 0;
  border-top: 1px solid ${color.line};
  &:first-of-type {
    border-top: 0;
  }
`

const PhotoHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]} ${space[4]};
  > :last-child {
    margin-left: auto;
  }
`

const List = styled.ul`
  display: grid;
  gap: ${space[4]};
  margin: ${space[2]} 0 ${space[4]};
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: ${space[4]};
    min-width: 0;
  }
  a {
    color: ${color.accent};
    ${linkTouchArea}
  }
`

const Reading = styled.span`
  display: grid;
  justify-items: start;
  gap: ${space[2]};
  flex: 1;
  min-width: 0;
  summary {
    ${type.small}
    color: ${color.muted};
  }
`

const Crop = styled.img`
  width: 56px;
  height: 56px;
  object-fit: cover;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
`

const FormedHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  ${CardTitle} {
    margin: 0;
  }
  > :last-child {
    margin-left: auto;
  }
`

const LotBlock = styled.section`
  display: grid;
  justify-items: start;
  gap: ${space[2]};
  padding: ${space[4]} 0;
  border-top: 1px solid ${color.line};
  a {
    color: ${color.fg};
    ${linkTouchArea}
  }
`

const LotHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[2]} ${space[4]};
  width: 100%;
`

const Pills = styled.span`
  display: inline-flex;
  gap: ${space[2]};
  margin-left: auto;
`

const Candidate = styled.div`
  display: grid;
  gap: ${space[2]};
`

const ReadingForm = styled.form`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
`

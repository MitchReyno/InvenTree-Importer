import styled from 'styled-components'
import type {
  CaptureSnapshotDto,
  MediaSnapshotDto,
  OperatorLotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { Field, Heading, Paragraph, Small, Subheading } from '../ui/primitives'
import { mediaResource } from '../../media/types'
import { ProcessingSources } from '../processing/ProcessingSources'
import { StatusChip } from './StatusChip'

type Lot = CaptureSnapshotDto['lots'][number]
type Part = CaptureSnapshotDto['parts'][number]
type Note = CaptureSnapshotDto['notes'][number]

interface Props {
  batch: CaptureSnapshotDto
  lot: Lot
  part: Part | undefined
  operatorLot?: OperatorLotDto
  media?: MediaSnapshotDto
  processing?: ProcessingSnapshotDto
}

interface SourcedNote {
  note: Note
  source: string
}

function evidenceNotes(
  batch: CaptureSnapshotDto,
  lot: Lot,
  part: Part | undefined,
  predecessorIds: string[],
): SourcedNote[] {
  const predecessors = new Map(
    predecessorIds.map((id) => [id, batch.lots.find((value) => value.id === id)?.label ?? 'lot']),
  )
  const notes: SourcedNote[] = []
  for (const note of batch.notes) {
    if (note.subject_id === null) {
      notes.push({ note, source: 'Batch note' })
    } else if (note.subject_id === lot.id) {
      notes.push({ note, source: 'Physical lot note' })
    } else if (note.subject_id === part?.id) {
      notes.push({ note, source: 'Shared Part note' })
    } else if (predecessors.has(note.subject_id)) {
      notes.push({ note, source: `From predecessor ${predecessors.get(note.subject_id)}` })
    }
  }
  return notes
}

function linkedEvidence(media: MediaSnapshotDto | undefined, subjectIds: Set<string>) {
  return (
    media?.evidence.filter((evidence) =>
      evidence.linked_subject_ids.some((id) => subjectIds.has(id)),
    ) ?? []
  )
}

function firstPreview(evidence: MediaSnapshotDto['evidence'][number]) {
  for (const version of evidence.versions) {
    const page = version.pages[0]
    if (page) {
      return { version, page }
    }
  }
  return null
}

/** Retained human evidence beside the decision panel; nothing here is inferred. */
export function LotEvidence({ batch, lot, part, operatorLot, media, processing }: Props) {
  const predecessorIds = operatorLot?.predecessor_lot_ids ?? []
  const notes = evidenceNotes(batch, lot, part, predecessorIds)
  const subjects = new Set([lot.id, ...predecessorIds, ...(part ? [part.id] : [])])
  const evidence = linkedEvidence(media, subjects)
  const proposals =
    processing?.jobs
      .filter((job) => subjects.has(job.subject_id))
      .flatMap((job) => job.proposals.map((proposal) => ({ job, proposal }))) ?? []
  return (
    <>
      <Heading>Human evidence</Heading>
      <Small>
        Original notes and retained files. No automated inference is shown as a chosen fact.
      </Small>
      <Paragraph>
        <strong>{lot.label}</strong> · {part?.label ?? 'No shared Part chosen'}
      </Paragraph>
      {notes.map(({ note, source }) => (
        <Field key={note.id}>
          <strong>{source}</strong>
          <OriginalNote>{note.text || 'Empty original note'}</OriginalNote>
          <Small>Human · {new Date(note.created_at).toLocaleString()}</Small>
        </Field>
      ))}
      {evidence.length > 0 && (
        <section aria-label="Linked retained media">
          <Subheading>Linked media</Subheading>
          <Thumbnails>
            {evidence.map((item) => {
              const preview = firstPreview(item)
              return (
                <figure key={item.id}>
                  {preview ? (
                    <img
                      src={mediaResource(batch.id, 'previews', preview.page.preview_id)}
                      alt={`${item.label}, ${preview.version.kind}`}
                    />
                  ) : (
                    <Small>No ready preview</Small>
                  )}
                  <figcaption>{item.label}</figcaption>
                </figure>
              )
            })}
          </Thumbnails>
        </section>
      )}
      {proposals.length > 0 && (
        <section aria-label="Processing candidates">
          <Subheading>Processing candidates</Subheading>
          {proposals.map(({ job, proposal }) => (
            <Field key={proposal.id}>
              <span>
                <StatusChip $tone="neutral">Fixture-only</StatusChip> {job.stage} · attempt{' '}
                {job.attempt_number}
              </span>
              <Paragraph>{proposal.value.summary}</Paragraph>
              <ProcessingSources proposal={proposal.value} />
              <Small>A candidate, not a chosen value. Choose facts explicitly below.</Small>
            </Field>
          ))}
        </section>
      )}
    </>
  )
}

const OriginalNote = styled(Paragraph)`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`
const Thumbnails = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  figure {
    margin: 0;
  }
  img {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: contain;
    background: #eef2f7;
    border: 1px solid #d5dce5;
    border-radius: 4px;
  }
  figcaption {
    font-size: 12px;
    color: #526179;
    overflow-wrap: anywhere;
  }
`

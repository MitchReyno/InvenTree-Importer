import styled from 'styled-components'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  MediaSnapshotDto,
  OperatorLotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { Field, Heading, Paragraph, Small, Subheading } from '../ui/primitives'
import { EvidenceViewer } from './EvidenceViewer'
import { ProcessingSources } from '../processing/ProcessingSources'
import { ProcessingSuggestions } from './ProcessingSuggestions'
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
  mediaUnavailable?: boolean
  mediaLoading?: boolean
  /** Explicit human edits that accept a suggestion; absent where Review is read-only. */
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
  editDisabled?: boolean
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

/** Retained human evidence beside the decision panel; nothing here is inferred. */
export function LotEvidence({
  batch,
  lot,
  part,
  operatorLot,
  media,
  processing,
  mediaUnavailable,
  mediaLoading,
  edit,
  editDisabled = true,
}: Props) {
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
      {!media && (mediaUnavailable || mediaLoading) && (
        <Small role="status">
          {mediaUnavailable
            ? 'Retained media is unavailable. File presence and previews could not be confirmed.'
            : 'Loading retained media…'}
        </Small>
      )}
      {media && (
        <EvidenceViewer
          key={lot.id}
          batchId={batch.id}
          lotId={lot.id}
          evidence={evidence}
          groups={media.groups}
          unavailable={mediaUnavailable}
        />
      )}
      {notes.map(({ note, source }) => (
        <Field key={note.id}>
          <strong>{source}</strong>
          <OriginalNote>{note.text || 'Empty original note'}</OriginalNote>
          <Small>Human · {new Date(note.created_at).toLocaleString()}</Small>
        </Field>
      ))}
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
              <ProcessingSuggestions
                lot={lot}
                part={part}
                proposal={proposal.value}
                disabled={editDisabled}
                edit={edit}
              />
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

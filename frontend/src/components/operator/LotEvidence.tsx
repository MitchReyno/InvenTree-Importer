import styled from 'styled-components'
import type {
  CaptureSnapshotDto,
  MediaSnapshotDto,
  OperatorLotDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { Paragraph, Small, Subheading, Pill, localTime } from '#/components/ui'
import { Field } from '#/forms'
import { color, type } from '#/theme/generated/tokens'
import { mediaDisplayLabels } from '#/media/identity-labels'
import { EvidenceViewer } from './EvidenceViewer'
import { ProcessingSources } from '#/components/processing/ProcessingSources'
import { ProcessingSuggestions } from './ProcessingSuggestions'
import { LotObservations } from './LotObservations'
import { useBatchCommands } from '#/context'

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
  processingCurrent?: boolean
  mediaUnavailable?: boolean
  mediaLoading?: boolean
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
  processingCurrent = false,
  mediaUnavailable,
  mediaLoading,
  editDisabled = true,
}: Props) {
  const { edit } = useBatchCommands()
  const predecessorIds = operatorLot?.predecessor_lot_ids ?? []
  const notes = evidenceNotes(batch, lot, part, predecessorIds)
  const subjects = new Set([lot.id, ...predecessorIds, ...(part ? [part.id] : [])])
  const evidence = linkedEvidence(media, subjects)
  const proposals =
    processing?.jobs.flatMap((job) =>
      job.proposals
        // The Examine lead job has no subject; its proposals name their lot.
        .filter((proposal) => subjects.has(job.subject_id ?? proposal.value.subject_id))
        .map((proposal) => ({ job, proposal })),
    ) ?? []
  const members = new Set(lot.evidence_observation_ids ?? [])
  const observations = (batch.evidence_observations ?? []).filter(
    (observation) => members.has(observation.id) && observation.status === 'active',
  ).length
  const files = media ? `${evidence.length} file${evidence.length === 1 ? '' : 's'}` : null
  return (
    <>
      <PaneTitle>
        {observations > 0
          ? `This lot's observations · ${observations}${files ? ` from ${files}` : ''}`
          : `This lot's evidence${files ? ` · ${files}` : ''}`}
      </PaneTitle>
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
          labels={mediaDisplayLabels(media.evidence)}
          unavailable={mediaUnavailable}
        />
      )}
      <LotObservations batch={batch} lot={lot} edit={edit} disabled={editDisabled} />
      {notes.map(({ note, source }) => (
        <Field key={note.id}>
          <strong>{source}</strong>
          <OriginalNote>{note.text || 'Empty original note'}</OriginalNote>
          <Small>
            Human
            {localTime(note.created_at) && ` · ${localTime(note.created_at)}`}
          </Small>
        </Field>
      ))}
      {proposals.length > 0 && (
        <section aria-label="Processing candidates">
          <Subheading>Processing candidates</Subheading>
          {proposals.map(({ job, proposal }) => (
            <Field key={proposal.id}>
              <span>
                <Pill tone="neutral">Fixture-only</Pill> {job.stage} · attempt {job.attempt_number}
              </span>
              <Paragraph>{proposal.value.summary}</Paragraph>
              <ProcessingSources proposal={proposal.value} />
              <ProcessingSuggestions
                lot={lot}
                part={part}
                proposal={proposal.value}
                defaultQuantity={batch.defaults.quantity}
                current={processingCurrent && job.state === 'ready'}
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

const PaneTitle = styled.h2`
  margin: 0;
  ${type.label}
  color: ${color.muted};
`

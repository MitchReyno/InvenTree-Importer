import { useCallback, useState, type ReactNode } from 'react'
import { Paragraph, Summary } from '#/components/ui'
import type { CaptureWorkspaceProps, Snapshot } from '#/capture/types'
import styled from 'styled-components'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'
import type { MediaClient } from '#/media/types'
import { MediaWorkspace } from '#/components/media/MediaWorkspace'
import type { OperatorReviewDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { CaptureActions } from './CaptureActions'
import { EvidenceNoteForm } from './EvidenceNoteForm'
import { HumanNote } from './HumanNote'

type Props = {
  batch: Snapshot
  operator?: OperatorReviewClient
  review?: OperatorReviewDto
  reload?: () => Promise<void>
  media?: MediaClient
  edit: CaptureWorkspaceProps['edit']
  frozen: boolean
  onMediaDirtyChange: (dirty: boolean) => void
  onNoteDirtyChange: (dirty: boolean) => void
  /** Receives the element where Batch settings draws the batch notes field. */
  notesSlot?: (element: HTMLElement | null) => void
  /** Shown right after the capture actions, such as the phone's lots glance. */
  afterActions?: ReactNode
}

/** Evidence actions, groups and batch notes; it no longer depends on a selected subject. */
export function EvidencePanel({
  batch,
  frozen,
  media,
  operator,
  review,
  reload,
  edit,
  onMediaDirtyChange,
  onNoteDirtyChange,
  notesSlot,
  afterActions,
}: Props) {
  const [writing, setWriting] = useState(false)
  // Notes and media each advance the revision; one owner's save must not remount the other's draft.
  const [mediaDirty, setMediaDirty] = useState(false)
  const [noteDirty, setNoteDirty] = useState(false)
  const reportMedia = useCallback(
    (dirty: boolean) => {
      setMediaDirty(dirty)
      onMediaDirtyChange(dirty)
    },
    [onMediaDirtyChange],
  )
  const reportNote = useCallback(
    (dirty: boolean) => {
      setNoteDirty(dirty)
      onNoteDirtyChange(dirty)
    },
    [onNoteDirtyChange],
  )
  const notes = batch.notes
  const latestNote = notes.at(-1)

  const writeNote = () => setWriting(true)

  return (
    <EvidenceArea data-area="context" aria-labelledby="evidence">
      {media && (
        <MediaWorkspace
          operator={operator}
          review={review}
          reload={reload}
          onWriteNote={writeNote}
          noteDisabled={frozen || writing || mediaDirty}
          batch={batch}
          client={media}
          disabled={frozen || noteDirty}
          onDirtyChange={reportMedia}
          captureEdit={edit}
          headingId="evidence"
          afterActions={afterActions}
        />
      )}
      {!media && (
        <CaptureActions
          mediaDisabled
          noteDisabled={frozen || writing}
          writeNote={writeNote}
          takePhotos={() => undefined}
          addDocument={() => undefined}
          unavailable
        />
      )}
      {!media && afterActions}
      {!media && <EvidenceLabel id="evidence">Evidence</EvidenceLabel>}
      {writing && (
        <EvidenceNoteForm
          disabled={frozen || mediaDirty}
          edit={edit}
          onDirtyChange={reportNote}
          onClose={() => setWriting(false)}
        />
      )}
      {notesSlot && <div ref={notesSlot} />}
      {latestNote && <HumanNote note={latestNote} batch={batch} />}
      {notes.length > 1 && (
        <details>
          <Summary>Earlier human notes · {notes.length - 1}</Summary>
          {notes.slice(0, -1).map((n) => (
            <HumanNote key={n.id} note={n} batch={batch} />
          ))}
        </details>
      )}
      <IdentityDetails>
        <Summary>Retained source identity</Summary>
        <Paragraph>Original source: {batch.source_id}</Paragraph>
        {batch.lots.map((l) => (
          <Paragraph key={l.id}>
            {l.label}: contribution {l.contribution_key}
          </Paragraph>
        ))}
        <Paragraph>No stock has been created by capture.</Paragraph>
      </IdentityDetails>
    </EvidenceArea>
  )
}

const EvidenceArea = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[7]};
  min-width: 0;
  padding: ${space[8]};
  border: 1px dashed ${color.lineStrong};
  border-radius: ${radius.card};
  background: ${color.surface};
`
const EvidenceLabel = styled.h2`
  margin: 0;
  ${type.label}
  color: ${color.muted};
`
const IdentityDetails = styled.details`
  overflow-wrap: anywhere;
  font-size: ${typeVar.small.size};
`

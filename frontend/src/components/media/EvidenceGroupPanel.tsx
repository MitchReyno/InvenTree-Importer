import type { CaptureWorkspaceProps } from '../../capture/types'
import { GroupLocationControl } from './GroupLocationControl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type {
  CaptureSnapshotDto,
  MediaSnapshotDto,
  MediaVersionDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import type { OperatorReviewClient } from '../../operator/types'
import type { MediaIdentityLabels } from '../../media/identity-labels'
import type { EditMedia } from '../../media/types'
import { Button, Paragraph } from '../ui/primitives'
import { color, space, type } from '../../theme/generated/tokens'
import { EvidenceDropZone } from './EvidenceDropZone'
import { EvidenceDragHandle } from './EvidenceDragHandle'
import { MediaEvidenceCard } from './MediaEvidenceCard'
import { EvidenceFileTile } from './EvidenceFileTile'
import { Modal } from '../operator/Modal'
import { EvidenceGrid } from '../ui/EvidenceTile'
import { MediaEvidenceRelations } from './MediaEvidenceRelations'
import { MediaTextEditor } from './MediaTextEditor'
import { MediaNoteSummary } from './MediaNoteSummary'
import { InstructionForm } from '../operator/InstructionForm'

type Props = {
  batch: CaptureSnapshotDto
  snapshot: MediaSnapshotDto
  groupId: string | null
  labels: MediaIdentityLabels
  confirmation: number
  frozen: boolean
  pending: boolean
  /** Retry and discard for an unconfirmed request, shown in the viewer that made it. */
  retained: ReactNode
  /** Why the last request failed; the page behind the viewer is inert. */
  notice: string | null
  selected: string[]
  edit: EditMedia
  blocked: (owner: string) => boolean
  dirty: (owner: string) => (value: boolean) => void
  select: (ids: string[]) => void
  choose: (kind: 'photos' | 'document', groupId?: string) => void
  crop: (version: MediaVersionDto, page: number) => void
  operator?: OperatorReviewClient
  review?: OperatorReviewDto
  reload?: () => Promise<void>
  /** Capture command for the group's location assignment; absent where capture is read-only. */
  captureEdit?: CaptureWorkspaceProps['edit']
}

export function EvidenceGroupPanel({
  batch,
  snapshot,
  groupId,
  labels,
  confirmation,
  frozen,
  pending,
  retained,
  notice,
  selected,
  edit,
  blocked,
  dirty,
  select,
  choose,
  crop,
  operator,
  review,
  reload,
  captureEdit,
}: Props) {
  const [rename, setRename] = useState(false)
  const [noteId, setNoteId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // Closing the viewer would unmount the note editor and lose its draft.
  const [noteDirty, setNoteDirty] = useState(false)
  const [instructions, setInstructions] = useState(false)
  const group = snapshot.groups.find((item) => item.id === groupId)
  const name = group?.label ?? 'Ungrouped'
  const evidence = snapshot.evidence.filter((item) => item.group_id === groupId)
  const opened = evidence.find((item) => item.id === openId)
  const renameKey = `rename:${groupId}`

  function supportedLots(item: MediaSnapshotDto['evidence'][number]) {
    const count = batch.lots.filter((lot) => item.linked_subject_ids.includes(lot.id)).length
    return count === 1 ? '1 lot' : `${count} lots`
  }

  // Two files with the same label get their distinguishing identity label.
  function fileName(item: MediaSnapshotDto['evidence'][number]) {
    const duplicate = snapshot.evidence.some(
      (other) => other.id !== item.id && other.label === item.label,
    )
    return duplicate ? (labels.evidence.get(item.id) ?? item.label) : item.label
  }

  const instructionKey = `instructions:${groupId}`
  const locationKey = `location:${groupId}`

  const acceptedConfirmation = useRef(confirmation)
  useEffect(() => {
    if (confirmation === acceptedConfirmation.current) {
      return
    }
    acceptedConfirmation.current = confirmation
    dirty(renameKey)(false)
    if (noteId) {
      dirty(`note:${noteId}`)(false)
    }
    setRename(false)
    setNoteId(null)
    setNoteDirty(false)
  }, [confirmation, dirty, renameKey, noteId])

  function closeViewer() {
    setNoteId(null)
    setOpenId(null)
  }

  return (
    <EvidenceDropZone
      groupId={groupId}
      label={`${name} · ${evidence.length} files`}
      disabled={frozen}
    >
      <GroupHead>
        <GroupName>{name}</GroupName>
        <FileCount>{evidence.length === 1 ? '1 file' : `${evidence.length} files`}</FileCount>
      </GroupHead>
      {group && (
        <>
          <GroupActions>
            <Button
              aria-label={`Rename ${name}`}
              disabled={blocked(renameKey)}
              onClick={() => setRename(true)}
            >
              Rename
            </Button>
            <Button
              aria-label={`Ungroup ${name}`}
              disabled={blocked('selection')}
              onClick={() => void edit({ kind: 'ungroup', group_id: group.id })}
            >
              Ungroup
            </Button>
            <Button
              aria-label={`Add photos to ${name}`}
              disabled={blocked('upload')}
              onClick={() => choose('photos', group.id)}
            >
              Add photos
            </Button>
            <Button
              aria-label={`Add document to ${name}`}
              disabled={blocked('upload')}
              onClick={() => choose('document', group.id)}
            >
              Add document
            </Button>
          </GroupActions>
          {rename && (
            <MediaTextEditor
              label={`Name for ${name}`}
              action="Save group name"
              text={name}
              revision={snapshot.revision}
              maximum={256}
              trim
              disabled={blocked(renameKey)}
              pending={pending}
              onDirtyChange={dirty(renameKey)}
              onCancel={() => setRename(false)}
              onSave={(label, revision) =>
                edit({ kind: 'rename_group', group_id: group.id, label }, revision)
              }
            />
          )}
          <MediaNoteSummary title="Group note" note={group.note} />
          {captureEdit && (
            <GroupLocationControl
              batch={batch}
              groupId={group.id}
              name={name}
              disabled={frozen || blocked(locationKey)}
              edit={captureEdit}
              reload={reload}
              onDirtyChange={dirty(locationKey)}
            />
          )}
          {operator && review && reload && (
            <>
              <Button disabled={blocked(instructionKey)} onClick={() => setInstructions(true)}>
                Edit note for group {name}
              </Button>
              {instructions && (
                <InstructionForm
                  batch={batch}
                  review={review}
                  client={operator}
                  groupId={group.id}
                  label={`Group “${name}”`}
                  disabled={blocked(instructionKey)}
                  reload={reload}
                  onDirtyChange={(_key, value) => dirty(instructionKey)(value)}
                />
              )}
            </>
          )}
        </>
      )}
      {!evidence.length && <Paragraph>No files in this group.</Paragraph>}
      <EvidenceGrid>
        {evidence.map((item) => {
          const controlLabel = fileName(item)
          return (
            <EvidenceDragHandle
              key={item.id}
              evidenceId={item.id}
              label={controlLabel}
              disabled={blocked('selection')}
            >
              <EvidenceFileTile
                batchId={batch.id}
                evidence={item}
                name={controlLabel}
                support={supportedLots(item)}
                selectable={!blocked('selection')}
                selected={selected.includes(item.id)}
                onSelect={(checked) =>
                  select(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
                }
                onOpen={() => setOpenId(item.id)}
              />
            </EvidenceDragHandle>
          )
        })}
      </EvidenceGrid>
      {opened && (
        <Modal title={fileName(opened)} onClose={closeViewer} closeDisabled={noteDirty}>
          <MediaEvidenceCard
            labels={labels}
            batchId={batch.id}
            evidence={opened}
            disabled={blocked('crop')}
            onCrop={crop}
          />
          <MediaNoteSummary title="Evidence note" note={opened.note} />
          <Button disabled={blocked(`note:${opened.id}`)} onClick={() => setNoteId(opened.id)}>
            Edit note for {fileName(opened)}
          </Button>
          {noteId === opened.id && (
            <MediaTextEditor
              label={`Note for ${fileName(opened)}`}
              action="Save evidence note"
              text={opened.note?.text ?? ''}
              revision={snapshot.revision}
              maximum={8192}
              multiline
              disabled={blocked(`note:${opened.id}`)}
              pending={pending}
              onDirtyChange={(value) => {
                setNoteDirty(value)
                dirty(`note:${opened.id}`)(value)
              }}
              onCancel={() => setNoteId(null)}
              onSave={(text, revision) =>
                edit({ kind: 'evidence_note', evidence_id: opened.id, text }, revision)
              }
            />
          )}
          {noteDirty && notice && <Paragraph role="alert">{notice}</Paragraph>}
          {noteDirty && pending && retained}
          <MediaEvidenceRelations
            batch={batch}
            evidence={opened}
            disabled={blocked('relations')}
            edit={edit}
          />
        </Modal>
      )}
    </EvidenceDropZone>
  )
}

const GroupHead = styled.div`
  display: flex;
  align-items: baseline;
  gap: ${space[2]};
`

const GroupName = styled.h3`
  margin: 0;
  ${type.h3}
`

const FileCount = styled.span`
  font-size: 12.5px;
  color: ${color.muted};
`

const GroupActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space['1-5']};
`

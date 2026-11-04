import type { CaptureWorkspaceProps } from '../../capture/types'
import { AssignedLocationField } from '../capture/AssignedLocationField'
import { useEffect, useRef, useState } from 'react'
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
import { Button, Paragraph, Subheading } from '../ui/primitives'
import { EvidenceDropZone } from './EvidenceDropZone'
import { EvidenceDragHandle } from './EvidenceDragHandle'
import { MediaEvidenceCard } from './MediaEvidenceCard'
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
  const [instructions, setInstructions] = useState(false)
  const group = snapshot.groups.find((item) => item.id === groupId)
  const name = group?.label ?? 'Ungrouped'
  const evidence = snapshot.evidence.filter((item) => item.group_id === groupId)
  const renameKey = `rename:${groupId}`
  const instructionKey = `instructions:${groupId}`

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
  }, [confirmation, dirty, renameKey, noteId])

  return (
    <EvidenceDropZone
      groupId={groupId}
      label={`${name} · ${evidence.length} files`}
      disabled={frozen}
    >
      <Subheading>
        {name} · {evidence.length}
      </Subheading>
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
            <AssignedLocationField
              label={`Location for group ${name}`}
              scope="Applies to lots linked to this group's evidence when they use the batch default and their shared Part has no location. Different group locations for one lot must be resolved in Review."
              value={batch.group_locations?.find((item) => item.group_id === group.id)?.location}
              batch={batch}
              disabled={frozen || pending}
              onChange={(location) =>
                void captureEdit({ kind: 'group_location', group_id: group.id, location })
              }
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
      {evidence.map((item) => {
        const duplicateName = snapshot.evidence.some(
          (other) => other.id !== item.id && other.label === item.label,
        )
        const controlLabel = duplicateName
          ? (labels.evidence.get(item.id) ?? item.label)
          : item.label
        const owner = `note:${item.id}`
        return (
          <EvidenceDragHandle
            key={item.id}
            evidenceId={item.id}
            label={controlLabel}
            disabled={blocked('selection')}
          >
            <EvidenceSelection>
              <input
                type="checkbox"
                aria-label={`Select ${controlLabel}`}
                checked={selected.includes(item.id)}
                disabled={blocked('selection')}
                onChange={(event) =>
                  select(
                    event.target.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id),
                  )
                }
              />
              Select {controlLabel}
            </EvidenceSelection>
            <MediaEvidenceCard
              labels={labels}
              batchId={batch.id}
              evidence={item}
              disabled={blocked('crop')}
              onCrop={crop}
            />
            <MediaNoteSummary title="Evidence note" note={item.note} />
            <Button disabled={blocked(owner)} onClick={() => setNoteId(item.id)}>
              Edit note for {controlLabel}
            </Button>
            {noteId === item.id && (
              <MediaTextEditor
                label={`Note for ${controlLabel}`}
                action="Save evidence note"
                text={item.note?.text ?? ''}
                revision={snapshot.revision}
                maximum={8192}
                multiline
                disabled={blocked(owner)}
                pending={pending}
                onDirtyChange={dirty(owner)}
                onCancel={() => setNoteId(null)}
                onSave={(text, revision) =>
                  edit({ kind: 'evidence_note', evidence_id: item.id, text }, revision)
                }
              />
            )}
            <MediaEvidenceRelations
              batch={batch}
              evidence={item}
              disabled={blocked('relations')}
              edit={edit}
            />
          </EvidenceDragHandle>
        )
      })}
    </EvidenceDropZone>
  )
}

const GroupActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
`
const EvidenceSelection = styled.label`
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
  min-height: 44px;
  input {
    width: auto;
    flex: none;
  }
`

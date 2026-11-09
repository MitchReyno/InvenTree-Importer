import { GroupLocationControl } from './GroupLocationControl'
import { useState, type ReactNode } from 'react'
import type {
  CaptureSnapshotDto,
  MediaSnapshotDto,
  MediaVersionDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import { mediaDisplayLabels, type MediaIdentityLabels } from '#/media/identity-labels'
import { reviewMap } from '#/operator/review-map'
import { predecessorLotIds } from '#/operator/review-model'
import type { EditMedia } from '#/media/types'
import { Paragraph, Button, EvidenceGroup, Dialog, EvidenceGrid } from '#/components/ui'
import { useEvidenceDropZone } from './EvidenceDropZone'
import { EvidenceDragHandle } from './EvidenceDragHandle'
import { MediaEvidenceCard } from './MediaEvidenceCard'
import { EvidenceFileTile } from './EvidenceFileTile'
import { MediaEvidenceRelations } from './MediaEvidenceRelations'
import { MediaTextEditor } from './MediaTextEditor'
import { MediaNoteSummary } from './MediaNoteSummary'
import { InstructionForm } from '#/components/operator/InstructionForm'
import { useApiClients } from '#/clients/api-clients'
import type { CaptureEdit } from '#/capture/types'

type Props = {
  batch: CaptureSnapshotDto
  snapshot: MediaSnapshotDto
  groupId: string | null
  labels: MediaIdentityLabels
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
  review?: OperatorReviewDto
  reload?: () => Promise<void>
  /** Capture command for the group's location assignment; absent where capture is read-only. */
  captureEdit?: CaptureEdit
}

export function EvidenceGroupPanel({
  batch,
  snapshot,
  groupId,
  labels,
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
  review,
  reload,
  captureEdit,
}: Props) {
  const { operator } = useApiClients()
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

  // The Map's own count: links to a lot, its Part or an earlier lot, and observed regions.
  const map = reviewMap(
    batch,
    snapshot.evidence,
    new Set(batch.lots.filter((lot) => lot.retired).map((lot) => lot.id)),
    predecessorLotIds(review),
  )
  const lotsOf = new Map(map.files.map((file) => [file.id, file.lotIds]))
  const groupLots = new Set(evidence.flatMap((item) => lotsOf.get(item.id) ?? []))
  // Without the review's lineage, links to a split or merged lot's predecessors can't be followed,
  // so counts are withheld rather than shown as zero, as the Map holds its conclusions.
  const lineageKnown = review !== undefined || !batch.lots.some((lot) => lot.retired)

  function supportedLots(item: MediaSnapshotDto['evidence'][number]) {
    if (!lineageKnown) {
      return undefined
    }
    const count = lotsOf.get(item.id)?.length ?? 0
    return count === 1 ? '1 lot' : `${count} lots`
  }

  // Files sharing a name are numbered; their identifiers stay in the viewer's details.
  const displayLabels = mediaDisplayLabels(snapshot.evidence)

  function fileName(item: MediaSnapshotDto['evidence'][number]) {
    return displayLabels.evidence.get(item.id) ?? item.label
  }

  const instructionKey = `instructions:${groupId}`
  const locationKey = `location:${groupId}`

  function closeViewer() {
    setNoteId(null)
    setOpenId(null)
  }

  const label = `${name} · ${evidence.length} files`
  const drop = useEvidenceDropZone(groupId, label, frozen)

  return (
    <EvidenceGroup
      ref={drop.ref}
      dropState={drop.dropState}
      name={name}
      count={evidence.length}
      meta={!lineageKnown ? undefined : groupLots.size === 1 ? '1 lot' : `${groupLots.size} lots`}
      ungrouped={!group}
      label={label}
      nameLabel={`Name for ${name}`}
      nameDisabled={blocked(renameKey)}
      onDraftChange={dirty(renameKey)}
      onRename={
        group
          ? (label) =>
              void edit({ kind: 'rename_group', group_id: group.id, label }, snapshot.revision)
          : undefined
      }
      actions={
        group && (
          <>
            <Button
              size="sm"
              icon="＋"
              aria-label={`Add photos to ${name}`}
              disabled={blocked('upload')}
              onClick={() => choose('photos', group.id)}
            >
              Add photos
            </Button>
            <Button
              size="sm"
              icon="＋"
              aria-label={`Add document to ${name}`}
              disabled={blocked('upload')}
              onClick={() => choose('document', group.id)}
            >
              Add document
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Ungroup ${name}`}
              disabled={blocked('selection')}
              onClick={() => void edit({ kind: 'ungroup', group_id: group.id })}
            >
              Ungroup
            </Button>
            {operator && review && reload && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Edit note for group ${name}`}
                disabled={blocked(instructionKey)}
                onClick={() => setInstructions(true)}
              >
                Edit note
              </Button>
            )}
          </>
        )
      }
    >
      {group && (
        <>
          <MediaNoteSummary title="Group note" note={group.note} />
          {operator && review && reload && instructions && (
            <InstructionForm
              batch={batch}
              review={review}
              client={operator}
              groupId={group.id}
              label={`Group “${name}”`}
              disabled={blocked(instructionKey)}
              reload={reload}
              onDirtyChange={dirty(instructionKey)}
            />
          )}
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
              {(handle) => (
                <EvidenceFileTile
                  batchId={batch.id}
                  evidence={item}
                  name={controlLabel}
                  support={supportedLots(item)}
                  handle={handle}
                  selectable={!blocked('selection')}
                  selected={selected.includes(item.id)}
                  onSelect={(checked) =>
                    select(
                      checked ? [...selected, item.id] : selected.filter((id) => id !== item.id),
                    )
                  }
                  onOpen={() => setOpenId(item.id)}
                  onNote={
                    blocked(`note:${item.id}`)
                      ? undefined
                      : () => {
                          setOpenId(item.id)
                          setNoteId(item.id)
                        }
                  }
                />
              )}
            </EvidenceDragHandle>
          )
        })}
      </EvidenceGrid>
      {opened && (
        <Dialog title={fileName(opened)} onClose={closeViewer} closeDisabled={noteDirty}>
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
                edit({ kind: 'evidence_note', evidence_id: opened.id, text }, revision, () => {
                  dirty(`note:${opened.id}`)(false)
                  setNoteId(null)
                  setNoteDirty(false)
                })
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
        </Dialog>
      )}
    </EvidenceGroup>
  )
}

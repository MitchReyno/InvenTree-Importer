import { mediaDisplayLabels, mediaIdentityLabels } from '#/media/identity-labels'
import { useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type } from '#/theme/generated/tokens'
import type {
  CaptureSnapshotDto,
  MediaEvidenceDto,
  MediaVersionDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import { Paragraph, Small, Banner, Toast, Button, HelpButton } from '#/components/ui'
import { Label, Select } from '#/forms'
import type { MediaClient } from '#/media/types'
import { useEvidenceWorkspace } from '#/media/useEvidenceWorkspace'
import { uploadProgress, useUploadQueue, type UploadItem } from '#/media/useUploadQueue'
import { MediaUpload, type EvidenceUploadHandle } from './MediaUpload'
import { MediaCropDialog } from './MediaCropDialog'
import { EvidenceDragContext } from './EvidenceDragContext'
import { EvidenceGroupPanel } from './EvidenceGroupPanel'
import { MediaTextEditor } from './MediaTextEditor'
import { SubjectAttachmentChoice } from './SubjectAttachmentChoice'
import { RemovalDialog } from './RemovalDialog'
import { DeletedFiles } from './DeletedFiles'
import { approvalRefusal, bulkApprovalRefusal } from '#/media/removal'
import type { CaptureEdit } from '#/capture/types'

interface Props {
  batch: CaptureSnapshotDto
  client: MediaClient
  disabled: boolean
  selectedSubject?: string
  onDirtyChange: (dirty: boolean) => void
  onWriteNote?: () => void
  noteDisabled?: boolean
  review?: OperatorReviewDto
  reload?: () => Promise<void>
  captureEdit?: CaptureEdit
  /** Id for the "Evidence" heading, so the enclosing area can be named by it. */
  headingId?: string
  /** Shown right after the capture actions. */
  afterActions?: ReactNode
}

const GROUPS_EXPLANATION =
  'Group photos that belong together, such as the front and back of one packet. Groups are hints: one photo can still feed several lots.'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** What Undo on the confirmation toast sends back. */
type ToastUndo =
  { kind: 'move'; ids: string[]; groupId: string | null } | { kind: 'restore'; ids: string[] }

type Confirmation = {
  /** Each confirmed change gets its own toast, even when its message repeats. */
  id: string
  message: string
  undo?: ToastUndo
}

/** A delete waiting for confirmation, pinned to the files and revision the dialog opened on. */
type PendingRemoval = { items: MediaEvidenceDto[]; revision: string }

function groupRegionId(groupId: string | null) {
  return `evidence-group-${groupId ?? 'ungrouped'}`
}

const ARCHIVED_DELETE = 'Resume the batch to delete files.'
const ARCHIVED_RESTORE = 'Resume the batch to restore files.'
const WAIT_DELETE = 'Delete waits until other evidence changes are saved or discarded.'
const WAIT_RESTORE = 'Restore waits until other evidence changes are saved or discarded.'
const ARCHIVED_MOVE = 'Resume the batch to move files.'
const WAIT_MOVE = 'Move waits until other evidence changes are saved or discarded.'
const NOWHERE_TO_MOVE = 'There’s no other group to move it to. Add a group first.'

export function MediaWorkspace({
  batch,
  client,
  disabled,
  selectedSubject,
  onDirtyChange,
  onWriteNote,
  noteDisabled = disabled,
  review,
  reload,
  captureEdit,
  headingId,
  afterActions,
}: Props) {
  const state = useEvidenceWorkspace(batch.id, client, disabled, onDirtyChange)
  const { snapshot, drafts, command, edit } = state
  const upload = useRef<EvidenceUploadHandle>(null)
  const uploads = useUploadQueue({
    currentRevision: async () => (await state.refresh()).revision,
    upload: (file, key, revision) => client.upload(batch.id, revision, file.name, file, key),
    finish: async (receipt, groupId) => {
      const current = await state.refresh()
      const original = current.evidence.find((item) => item.id === receipt.evidence_id)
      if (!original?.versions.some((version) => version.id === receipt.version.id)) {
        throw new Error('retained_original_not_in_fresh_projection')
      }
      state.accept(current)
      uploads.forgetPlaced(current.evidence)
      // Already in a group, whether the intended one or one the operator chose: nothing to move.
      if (!groupId || original.group_id !== null) {
        return true
      }
      // An unconfirmed or refused move still owns the command and selection, and a frozen batch
      // sends no move; this file waits in Ungrouped rather than holding a selection for nothing.
      if (disabled || command.hasPendingIntent() || drafts.isDirty('selection')) {
        return false
      }
      // Original retention is complete before membership is attempted. The read above is fresh,
      // even if this handler's render still shows an earlier failed poll.
      state.select([receipt.evidence_id], current.revision)
      const moved = await state.move([receipt.evidence_id], groupId, current.revision, {
        readConfirmed: true,
      })
      return moved !== 'unconfirmed'
    },
    onDirtyChange: drafts.forSource('upload'),
  })
  const [newGroup, setNewGroup] = useState(false)
  const [destinationGroup, setDestinationGroup] = useState('')
  const [toast, setToast] = useState<Confirmation | null>(null)
  const [removal, setRemoval] = useState<PendingRemoval | null>(null)
  // A restored file's actions button takes focus when it mounts; Undo and Restore set this.
  const focusOnMount = useRef<string | null>(null)
  const deletedSummary = useRef<HTMLElement>(null)
  // Set by a tile's Move to group…, so the move control takes focus when it appears.
  const focusMoveControl = useRef(false)
  // Where focus goes when the delete dialog closes: its opener, unless the delete was confirmed.
  const removalOpener = useRef<HTMLElement | null>(null)
  const removalConfirmed = useRef(false)
  const [crop, setCrop] = useState<{
    version: MediaVersionDto
    page: number
    revision: string
  } | null>(null)
  const identityLabels = mediaIdentityLabels(snapshot?.evidence ?? [])
  const activeGroups = new Set(snapshot?.groups.map((group) => group.id))

  // The latest read, not the shown snapshot, which drafts can hold back.
  const latestRead = state.query.data ?? snapshot

  // "Added to Ungrouped" is false once a read shows the file in any group. Refresh and finish
  // drop such notices; this hides one a poll has overtaken until then.
  function placedInAGroup(item: UploadItem) {
    if (item.status !== 'ungrouped' || !item.evidenceId) {
      return false
    }
    const evidence = latestRead?.evidence.find((entry) => entry.id === item.evidenceId)
    return evidence !== undefined && evidence.group_id !== null
  }

  // A file bound for a group that has since gone is shown with the ungrouped files.
  function uploadsIn(groupId: string | null) {
    return uploads.items.filter((item) => {
      const shownIn = item.groupId && activeGroups.has(item.groupId) ? item.groupId : null
      return shownIn === groupId && !placedInAGroup(item)
    })
  }

  const frozen = disabled || command.busy || command.pending || !snapshot || state.unavailable

  const blocked = (owner: string) => frozen || drafts.hasOtherSources(owner)

  // Retry and Read again never touch the selection, so a held selection must not lock them.
  const uploadActionsDisabled = frozen || drafts.hasOtherSources('upload', 'selection')
  // Clearing or reloading a selection never sends media, so queued uploads must not lock it.
  const selectionResetDisabled = drafts.hasOtherSources('selection', 'upload')

  // A confirmed move is undoable when its files all came from one group; a delete always is. The
  // toast is forgotten once nothing is retained: confirmed or refused on retry, or discarded.
  const unconfirmedChange = useRef<Confirmation | null>(null)

  const displayLabels = mediaDisplayLabels(snapshot?.evidence ?? [])

  function fileName(item: MediaEvidenceDto) {
    return displayLabels.evidence.get(item.id) ?? item.label
  }

  // Delete and Restore never touch the selection, so a held selection doesn't lock them.
  const removalBlocked = frozen || drafts.hasOtherSources('removal', 'selection')

  function deleteRefusal(item: MediaEvidenceDto) {
    const refusal = approvalRefusal(item)
    if (refusal) {
      return refusal
    }
    if (batch.archived) {
      return ARCHIVED_DELETE
    }
    return removalBlocked ? WAIT_DELETE : null
  }

  // The groups a file could go to: every other group, and Ungrouped when it is in one.
  function moveDestinations(item: MediaEvidenceDto) {
    const groups = (snapshot?.groups ?? [])
      .filter((group) => group.id !== item.group_id)
      .map((group) => group.id)
    return item.group_id === null ? groups : [null, ...groups]
  }

  function moveRefusal(item: MediaEvidenceDto) {
    if (batch.archived) {
      return ARCHIVED_MOVE
    }
    if (blocked('selection')) {
      return WAIT_MOVE
    }
    return moveDestinations(item).length ? null : NOWHERE_TO_MOVE
  }

  /** Selects only this file and opens the selection's move control on its first destination. */
  function moveToGroup(item: MediaEvidenceDto) {
    const [destination] = moveDestinations(item)
    focusMoveControl.current = true
    setDestinationGroup(destination ?? '')
    state.select([item.id])
  }

  function focusMoveDestination(element: HTMLSelectElement | null) {
    if (element && focusMoveControl.current) {
      focusMoveControl.current = false
      element.focus()
    }
  }

  function restoreRefusal() {
    if (batch.archived) {
      return ARCHIVED_RESTORE
    }
    return removalBlocked ? WAIT_RESTORE : null
  }

  const selectedItems = (snapshot?.evidence ?? []).filter((item) =>
    state.selected.includes(item.id),
  )
  const bulkDeleteRefusal = bulkApprovalRefusal(selectedItems, fileName)

  function requestRemoval(items: MediaEvidenceDto[]) {
    if (!snapshot || !items.length) {
      return
    }
    // The dialog's own opener check can't tell a confirmed delete, whose file leaves in the same
    // commit, from a cancelled one, so focus leaves the opener and `returnFocus` decides.
    const active = document.activeElement
    removalOpener.current = active instanceof HTMLElement ? active : null
    removalConfirmed.current = false
    removalOpener.current?.blur()
    setRemoval({ items, revision: snapshot.revision })
  }

  function focusAfterRemoval(pending: PendingRemoval) {
    const opener = removalOpener.current
    if (!removalConfirmed.current && opener?.isConnected) {
      return opener
    }
    return document.getElementById(groupRegionId(pending.items[0].group_id))
  }

  async function confirmRemoval(pending: PendingRemoval) {
    const ids = pending.items.map((item) => item.id)
    const [first] = pending.items
    const message =
      ids.length === 1 ? `Deleted ${fileName(first)}` : `Deleted ${plural(ids.length, 'file')}`
    const confirmation: Confirmation = {
      id: crypto.randomUUID(),
      message,
      undo: { kind: 'restore', ids },
    }
    const saved = await state.edit({ kind: 'remove', evidence_ids: ids }, pending.revision)
    if (saved) {
      removalConfirmed.current = true
      state.select(state.selected.filter((id) => !ids.includes(id)))
      setToast(confirmation)
    } else if (command.hasPendingIntent()) {
      unconfirmedChange.current = confirmation
    }
    setRemoval(null)
  }

  /** Sends `restore`; the first restored file's actions button takes focus as it comes back. */
  async function restore(ids: string[]) {
    focusOnMount.current = ids[0]
    const saved = await state.edit({ kind: 'restore', evidence_ids: ids })
    if (!saved) {
      focusOnMount.current = null
    }
    return saved
  }

  async function undoFromToast(undo: ToastUndo) {
    setToast(null)
    if (undo.kind === 'move') {
      await state.move(undo.ids, undo.groupId)
      return
    }
    const saved = await restore(undo.ids)
    // The toast is gone; the file waits in Deleted files, where Restore can be tried again.
    if (!saved) {
      deletedSummary.current?.focus()
    }
  }

  function focusRestored(evidenceId: string, element: HTMLButtonElement | null) {
    if (element && focusOnMount.current === evidenceId) {
      focusOnMount.current = null
      element.focus()
    }
  }

  async function moveEvidence(ids: string[], groupId: string | null) {
    const origins = new Set(
      snapshot?.evidence.filter((item) => ids.includes(item.id)).map((item) => item.group_id),
    )
    const name = groupId
      ? (snapshot?.groups.find((group) => group.id === groupId)?.label ?? 'a group')
      : 'Ungrouped'
    const [origin] = origins
    const confirmation: Confirmation = {
      id: crypto.randomUUID(),
      message: `Moved ${plural(ids.length, 'file')} to ${name}`,
      undo: origins.size === 1 ? { kind: 'move', ids, groupId: origin ?? null } : undefined,
    }
    const result = await state.move(ids, groupId)
    if (result === 'saved') {
      setToast(confirmation)
    } else if (result === 'unconfirmed' && command.hasPendingIntent()) {
      // Only a retained, uncertain move can still be confirmed by an exact retry.
      unconfirmedChange.current = confirmation
    }
    return result
  }

  const retained = (
    <>
      <Button
        disabled={command.busy || state.unavailable || disabled}
        onClick={() => {
          const change = unconfirmedChange.current
          void state.retry().then((saved) => {
            if (saved && change) {
              setToast(change)
            }
            if (!command.hasPendingIntent()) {
              unconfirmedChange.current = null
            }
          })
        }}
      >
        Retry exact media request
      </Button>
      <Button
        disabled={command.busy}
        onClick={() => {
          unconfirmedChange.current = null
          state.discard()
        }}
      >
        Discard unconfirmed media request
      </Button>
    </>
  )

  return (
    <Workspace aria-label="Retained evidence">
      <MediaUpload
        ref={upload}
        chooseDisabled={blocked('upload')}
        noteDisabled={noteDisabled}
        onWriteNote={onWriteNote}
        queue={uploads}
      />
      {afterActions}
      <LabelRow>
        <EvidenceLabel id={headingId}>Evidence</EvidenceLabel>
        {snapshot && (
          <Small as="span">
            {plural(snapshot.evidence.length, 'file')} · {plural(snapshot.groups.length, 'group')}
          </Small>
        )}
        <HelpButton label="About groups" explanation={GROUPS_EXPLANATION} />
        <Spacer />
        {snapshot && (
          <Button
            size="sm"
            icon="＋"
            disabled={blocked('new-group')}
            onClick={() => setNewGroup(true)}
          >
            New group
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Refresh saved evidence"
          disabled={command.busy}
          onClick={() =>
            void state
              .refresh()
              .then((value) => uploads.forgetPlaced(value.evidence))
              .catch(() => state.setError('Refresh failed. Local drafts are preserved.'))
          }
        >
          Refresh
        </Button>
      </LabelRow>
      {state.unavailable && (
        <div role="alert">
          <Banner tone="warn">
            Current saved media could not be confirmed. Local file, selection and crop inputs are
            preserved; media changes wait for a fresh read.
          </Banner>
        </div>
      )}
      {state.error && (
        <div role="alert">
          <Banner tone="bad">{state.error}</Banner>
        </div>
      )}
      {command.message && (
        <div role="alert">
          <Banner tone="bad" action={command.pending ? <Actions>{retained}</Actions> : undefined}>
            {command.message}
          </Banner>
        </div>
      )}
      {command.pending && !command.message && retained}
      {snapshot && (
        <>
          {newGroup && (
            <MediaTextEditor
              label="New group name"
              action="Create group"
              text=""
              revision={snapshot.revision}
              maximum={256}
              trim
              disabled={blocked('new-group')}
              pending={command.pending}
              onDirtyChange={drafts.forSource('new-group')}
              onCancel={() => setNewGroup(false)}
              onSave={(label, revision) =>
                edit({ kind: 'group', label }, revision, () => {
                  setNewGroup(false)
                  drafts.forSource('new-group')(false)
                })
              }
            />
          )}
          {state.selected.length > 0 && (
            <MoveControls aria-label="Selected evidence">
              <Small>{state.selected.length} selected · exact evidence identities retained</Small>
              <Label>
                Move selected evidence to
                <Select
                  ref={focusMoveDestination}
                  value={destinationGroup}
                  disabled={blocked('selection')}
                  onChange={(event) => setDestinationGroup(event.target.value)}
                >
                  <option value="">Ungrouped</option>
                  {snapshot.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </Select>
              </Label>
              <Button
                disabled={blocked('selection')}
                onClick={() => void moveEvidence(state.selected, destinationGroup || null)}
              >
                Move selected evidence
              </Button>
              <Button
                variant="warn"
                aria-describedby={bulkDeleteRefusal ? 'bulk-delete-refusal' : undefined}
                disabled={blocked('selection') || bulkDeleteRefusal !== null}
                onClick={() => requestRemoval(selectedItems)}
              >
                Delete {plural(state.selected.length, 'file')}…
              </Button>
              {bulkDeleteRefusal && <Small id="bulk-delete-refusal">{bulkDeleteRefusal}</Small>}
              <Button disabled={frozen || selectionResetDisabled} onClick={() => state.select([])}>
                Clear evidence selection
              </Button>
              <Button
                disabled={command.pending || command.busy || disabled || selectionResetDisabled}
                onClick={() => void state.reconcile()}
              >
                Reload membership for a new move
              </Button>
            </MoveControls>
          )}
          <EvidenceDragContext
            disabled={frozen || drafts.hasOtherSources('selection', 'drag')}
            onDraggingChange={drafts.forSource('drag')}
            onMove={(id, groupId) =>
              moveEvidence(state.selected.includes(id) ? state.selected : [id], groupId)
            }
          >
            <Groups>
              {[...snapshot.groups.map((group) => group.id), null].map((groupId) => {
                const groupUploads = uploadsIn(groupId)
                return (
                  <EvidenceGroupPanel
                    key={groupId ?? 'ungrouped'}
                    batch={batch}
                    snapshot={snapshot}
                    groupId={groupId}
                    labels={identityLabels}
                    frozen={frozen}
                    pending={command.pending}
                    retained={retained}
                    notice={command.message || state.error || null}
                    selected={state.selected}
                    edit={edit}
                    captureEdit={captureEdit}
                    blocked={(owner) =>
                      owner === 'selection'
                        ? frozen || drafts.hasOtherSources('selection', 'drag')
                        : blocked(owner)
                    }
                    dirty={drafts.forSource}
                    select={state.select}
                    choose={(kind, id) => upload.current?.choose(kind, id)}
                    uploads={groupUploads}
                    uploadProgress={uploadProgress(groupUploads)}
                    uploadQueue={uploads}
                    uploadActionsDisabled={uploadActionsDisabled}
                    crop={(version, page) => {
                      drafts.forSource('crop')(true)
                      setCrop({ version, page, revision: snapshot.revision })
                    }}
                    review={review}
                    reload={reload}
                    regionId={groupRegionId(groupId)}
                    deleteRefusal={deleteRefusal}
                    onDelete={(item) => requestRemoval([item])}
                    moveRefusal={moveRefusal}
                    onMoveToGroup={moveToGroup}
                    actionsRef={focusRestored}
                  />
                )
              })}
            </Groups>
          </EvidenceDragContext>
          {snapshot.removed && (
            <DeletedFiles
              batchId={batch.id}
              removed={snapshot.removed}
              restoreRefusal={restoreRefusal()}
              summaryRef={deletedSummary}
              onRestore={(item) => void restore([item.id])}
            />
          )}
          {selectedSubject && (
            <SubjectAttachmentChoice
              batch={batch}
              subjectId={selectedSubject}
              snapshot={snapshot}
              disabled={blocked('attachment')}
              edit={edit}
            />
          )}

          {snapshot.derivations
            .filter((item) => item.state !== 'ready')
            .map((item) => (
              <Paragraph key={item.id} role="status">
                Crop preparation: {item.state.replaceAll('_', ' ')}
              </Paragraph>
            ))}
        </>
      )}
      {crop && snapshot && (
        <MediaCropDialog
          key={`${crop.version.id}:${crop.page}`}
          batchId={batch.id}
          version={crop.version}
          pageNumber={crop.page}
          revision={crop.revision}
          snapshot={snapshot}
          readUnavailable={state.unavailable || disabled}
          onDirtyChange={drafts.forSource('crop')}
          close={() => {
            drafts.forSource('crop')(false)
            setCrop(null)
          }}
          save={state.saveCrop}
        />
      )}
      {removal && (
        <RemovalDialog
          batch={batch}
          client={client}
          items={removal.items}
          revision={removal.revision}
          name={fileName}
          busy={command.busy}
          onConfirm={() => void confirmRemoval(removal)}
          onClose={() => setRemoval(null)}
          returnFocus={() => focusAfterRemoval(removal)}
        />
      )}
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          action={
            // Undo waits for other drafts, as any move does, so it cannot discard them.
            toast.undo && !(frozen || drafts.hasOtherSources('selection', 'drag'))
              ? { label: 'Undo', onClick: () => void undoFromToast(toast.undo!) }
              : undefined
          }
          onDismiss={() => setToast(null)}
        />
      )}
    </Workspace>
  )
}

const Workspace = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[7]};
  min-width: 0;
`
const LabelRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`
const EvidenceLabel = styled.h2`
  margin: 0;
  ${type.label}
  color: ${color.muted};
`
const Spacer = styled.span`
  flex: 1;
`
const Actions = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`
const Groups = styled.div`
  display: grid;
  gap: ${space[6]};
  min-width: 0;
`
const MoveControls = styled.div`
  display: grid;
  gap: ${space[4]};
  padding: ${space[6]};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.card};
  min-width: 0;
  select {
    max-width: 100%;
  }
`

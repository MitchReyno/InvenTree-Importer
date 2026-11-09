import { mediaIdentityLabels } from '#/media/identity-labels'
import { useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type } from '#/theme/generated/tokens'
import type { CaptureSnapshotDto, MediaVersionDto, OperatorReviewDto } from '@invimport/contracts'
import { Paragraph, Small, Banner, Toast, Button } from '#/components/ui'
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

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

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
      if (!groupId) {
        return true
      }
      // An unconfirmed or refused move still owns the command and selection; this file waits in
      // Ungrouped rather than replacing them.
      if (command.hasPendingIntent() || drafts.isDirty('selection')) {
        return false
      }
      // Original retention is complete before membership is attempted.
      state.select([receipt.evidence_id], current.revision)
      const moved = await state.move([receipt.evidence_id], groupId, current.revision)
      return moved !== 'unconfirmed'
    },
    onDirtyChange: drafts.forSource('upload'),
  })
  const [newGroup, setNewGroup] = useState(false)
  const [destinationGroup, setDestinationGroup] = useState('')
  const [moved, setMoved] = useState<{
    /** Each confirmed move gets its own toast, even when its message repeats. */
    id: string
    message: string
    undo?: { ids: string[]; groupId: string | null }
  } | null>(null)
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

  // A confirmed move is undoable when its files all came from one group. It is forgotten once
  // nothing is retained: confirmed or refused on retry, or discarded.
  const unconfirmedMove = useRef<typeof moved>(null)

  async function moveEvidence(ids: string[], groupId: string | null) {
    const origins = new Set(
      snapshot?.evidence.filter((item) => ids.includes(item.id)).map((item) => item.group_id),
    )
    const name = groupId
      ? (snapshot?.groups.find((group) => group.id === groupId)?.label ?? 'a group')
      : 'Ungrouped'
    const [origin] = origins
    const confirmation = {
      id: crypto.randomUUID(),
      message: `Moved ${plural(ids.length, 'file')} to ${name}`,
      undo: origins.size === 1 ? { ids, groupId: origin ?? null } : undefined,
    }
    const result = await state.move(ids, groupId)
    if (result === 'saved') {
      setMoved(confirmation)
    } else if (result === 'unconfirmed' && command.hasPendingIntent()) {
      // Only a retained, uncertain move can still be confirmed by an exact retry.
      unconfirmedMove.current = confirmation
    }
    return result
  }

  const retained = (
    <>
      <Button
        disabled={command.busy || state.unavailable || disabled}
        onClick={() => {
          const move = unconfirmedMove.current
          void state.retry().then((saved) => {
            if (saved && move) {
              setMoved(move)
            }
            if (!command.hasPendingIntent()) {
              unconfirmedMove.current = null
            }
          })
        }}
      >
        Retry exact media request
      </Button>
      <Button
        disabled={command.busy}
        onClick={() => {
          unconfirmedMove.current = null
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
      <Small>
        Group photos that belong together, such as the front and back of one packet. Originals,
        links and lot identities are kept; up to 200 selected files move together.
      </Small>
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
                  />
                )
              })}
            </Groups>
          </EvidenceDragContext>
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
      {moved && (
        <Toast
          key={moved.id}
          message={moved.message}
          action={
            // Undo waits for other drafts, as any move does, so it cannot discard them.
            moved.undo && !(frozen || drafts.hasOtherSources('selection', 'drag'))
              ? {
                  label: 'Undo',
                  onClick: () => {
                    const undo = moved.undo!
                    setMoved(null)
                    void state.move(undo.ids, undo.groupId)
                  },
                }
              : undefined
          }
          onDismiss={() => setMoved(null)}
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

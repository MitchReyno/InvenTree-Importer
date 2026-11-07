import { mediaIdentityLabels } from '../../media/identity-labels'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { color, radius, space, type } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, MediaVersionDto, OperatorReviewDto } from '@invimport/contracts'
import { Label, Paragraph, Select, Small } from '../ui/primitives'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import type { CaptureWorkspaceProps } from '../../capture/types'
import type { MediaClient } from '../../media/types'
import type { OperatorReviewClient } from '../../operator/types'
import { useEvidenceWorkspace } from '../../media/useEvidenceWorkspace'
import { MediaUpload, type EvidenceUploadHandle } from './MediaUpload'
import { MediaCropDialog } from './MediaCropDialog'
import { EvidenceDragContext } from './EvidenceDragContext'
import { EvidenceGroupPanel } from './EvidenceGroupPanel'
import { MediaTextEditor } from './MediaTextEditor'
import { SubjectAttachmentChoice } from './SubjectAttachmentChoice'

interface Props {
  batch: CaptureSnapshotDto
  client: MediaClient
  disabled: boolean
  selectedSubject?: string
  onDirtyChange: (dirty: boolean) => void
  onWriteNote?: () => void
  noteDisabled?: boolean
  operator?: OperatorReviewClient
  review?: OperatorReviewDto
  reload?: () => Promise<void>
  captureEdit?: CaptureWorkspaceProps['edit']
  /** Id for the "Evidence" heading, so the enclosing area can be named by it. */
  headingId?: string
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
  operator,
  review,
  reload,
  captureEdit,
  headingId,
}: Props) {
  const state = useEvidenceWorkspace(batch.id, client, disabled, onDirtyChange)
  const { snapshot, drafts, command, edit } = state
  const upload = useRef<EvidenceUploadHandle>(null)
  const [newGroup, setNewGroup] = useState(false)
  const [destinationGroup, setDestinationGroup] = useState('')
  const confirmation = useRef(state.confirmation)
  useEffect(() => {
    if (confirmation.current !== state.confirmation) {
      confirmation.current = state.confirmation
      setNewGroup(false)
      drafts.forSource('new-group')(false)
    }
  }, [state.confirmation, drafts.forSource])
  const [crop, setCrop] = useState<{
    version: MediaVersionDto
    page: number
    revision: string
  } | null>(null)
  const identityLabels = mediaIdentityLabels(snapshot?.evidence ?? [])
  const frozen = disabled || command.busy || command.pending || !snapshot || state.unavailable

  const blocked = (owner: string) => frozen || drafts.hasOtherSources(owner)

  const retained = (
    <>
      <Button
        disabled={command.busy || state.unavailable || disabled}
        onClick={() => void state.retry()}
      >
        Retry exact media request
      </Button>
      <Button disabled={command.busy} onClick={state.discard}>
        Discard unconfirmed media request
      </Button>
    </>
  )

  return (
    <Workspace aria-label="Retained evidence">
      <MediaUpload
        ref={upload}
        disabled={blocked('upload')}
        chooseDisabled={blocked('upload')}
        noteDisabled={noteDisabled}
        onWriteNote={onWriteNote}
        revision={snapshot?.revision ?? '0'}
        onDirtyChange={drafts.forSource('upload')}
        upload={(file, key, revision) => client.upload(batch.id, revision, file.name, file, key)}
        finish={async (receipt, groupId) => {
          const current = await state.refresh()
          const original = current.evidence.find((item) => item.id === receipt.evidence_id)
          if (!original?.versions.some((version) => version.id === receipt.version.id)) {
            throw new Error('retained_original_not_in_fresh_projection')
          }
          state.accept(current)
          if (groupId) {
            // Original retention is complete before membership is attempted.
            state.select([receipt.evidence_id], current.revision)
            await state.move([receipt.evidence_id], groupId, current.revision)
          }
        }}
      />
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
            aria-label="New evidence group"
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
              onSave={(label, revision) => edit({ kind: 'group', label }, revision)}
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
                onClick={() => void state.move(state.selected, destinationGroup || null)}
              >
                Move selected evidence
              </Button>
              <Button
                disabled={frozen || drafts.hasOtherSources('selection')}
                onClick={() => state.select([])}
              >
                Clear evidence selection
              </Button>
              <Button
                disabled={
                  command.pending || command.busy || disabled || drafts.hasOtherSources('selection')
                }
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
              state.move(state.selected.includes(id) ? state.selected : [id], groupId)
            }
          >
            <Groups>
              {[...snapshot.groups.map((group) => group.id), null].map((groupId) => (
                <EvidenceGroupPanel
                  key={groupId ?? 'ungrouped'}
                  batch={batch}
                  snapshot={snapshot}
                  groupId={groupId}
                  confirmation={state.confirmation}
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
                  crop={(version, page) => {
                    drafts.forSource('crop')(true)
                    setCrop({ version, page, revision: snapshot.revision })
                  }}
                  operator={operator}
                  review={review}
                  reload={reload}
                />
              ))}
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

import { useCallback } from 'react'
import styled from 'styled-components'
import type { MediaEditDto } from '@invimport/contracts'
import type { CaptureWorkspaceProps, Snapshot } from '../../capture/types'
import type { MediaClient } from '../../media/types'
import { useEvidenceWorkspace } from '../../media/useEvidenceWorkspace'
import { CaptureEditor } from '../capture/CaptureEditor'
import { SubjectAttachmentChoice } from '../media/SubjectAttachmentChoice'
import { Button, Heading, HeadingRow, Panel, Small } from '../ui/primitives'

export const ADD_LOT = 'add_lot'
export const ADD_PART = 'add_part'

type Props = {
  batch: Snapshot
  subjectId: string
  disabled: boolean
  dirty: boolean
  edit: CaptureWorkspaceProps['edit']
  observe: CaptureWorkspaceProps['observe']
  media?: MediaClient
  onDirtyChange: (dirty: boolean) => void
  onAttachmentDirtyChange: (dirty: boolean) => void
  /** Reloads saved values after a confirmed attachment change advances the revision. */
  reload: () => Promise<void>
  onClose: () => void
  /** Keeps the subject in the URL while the editor is open; cleared while a save is in flight. */
  retainRoute: (retain: boolean) => void
}

/** Focused manual create/edit for one subject using the existing capture commands. */
export function ReviewSubjectEditor({
  batch,
  subjectId,
  disabled,
  dirty,
  edit,
  observe,
  media,
  onDirtyChange,
  onAttachmentDirtyChange,
  reload,
  onClose,
  retainRoute,
}: Props) {
  const lot = batch.lots.find((item) => item.id === subjectId)
  const part = batch.parts.find((item) => item.id === subjectId)
  let title = 'Add a physical lot'
  if (lot) {
    title = `Lot: ${lot.label}`
  } else if (part) {
    title = `Shared Part: ${part.label}`
  } else if (subjectId === ADD_PART) {
    title = 'Add a shared Part proposal'
  }

  // A successful save remounts Review at the new revision, which must not reopen this editor.
  const save = useCallback<CaptureWorkspaceProps['edit']>(
    async (change) => {
      retainRoute(false)
      const saved = await edit(change)
      if (saved === false) {
        retainRoute(true)
      } else {
        onDirtyChange(false)
        onClose()
      }
      return saved
    },
    [edit, onClose, onDirtyChange, retainRoute],
  )

  return (
    <EditorPanel role="region" aria-labelledby="subject-editor-title">
      <HeadingRow>
        <Heading id="subject-editor-title">{title}</Heading>
        <Button type="button" disabled={dirty} onClick={onClose}>
          Close editor{dirty ? ' · save or discard first' : ''}
        </Button>
      </HeadingRow>
      <Small>Saved values are human choices, not inferred or approved inventory effects.</Small>
      {part && (
        <Small>
          Affects {batch.lots.filter((item) => item.part_subject_id === part.id).length} lots.
          Sharing a Part does not combine their quantities or contribution identities.
        </Small>
      )}
      <CaptureEditor
        key={subjectId}
        batch={batch}
        selected={subjectId}
        frozen={disabled}
        dirty={dirty}
        onDirty={onDirtyChange}
        edit={save}
        observe={observe}
      />
      {media && (lot || part) && (
        <ReviewAttachment
          batch={batch}
          subjectId={subjectId}
          client={media}
          disabled={disabled}
          onDirtyChange={onAttachmentDirtyChange}
          reload={reload}
        />
      )}
    </EditorPanel>
  )
}

function ReviewAttachment({
  batch,
  subjectId,
  client,
  disabled,
  onDirtyChange,
  reload,
}: {
  batch: Snapshot
  subjectId: string
  client: MediaClient
  disabled: boolean
  onDirtyChange: (dirty: boolean) => void
  reload: () => Promise<void>
}) {
  const state = useEvidenceWorkspace(batch.id, client, disabled, onDirtyChange)
  const { command } = state

  async function choose(change: MediaEditDto['change']) {
    if (await state.edit(change)) {
      await reload()
    }
  }

  async function retry() {
    await state.retry()
    if (!command.hasPendingIntent()) {
      await reload()
    }
  }

  if (!state.snapshot) {
    return <Small role="status">Reading retained attachments…</Small>
  }
  return (
    <>
      <SubjectAttachmentChoice
        batch={batch}
        subjectId={subjectId}
        snapshot={state.snapshot}
        disabled={disabled || command.busy || command.pending || state.unavailable}
        edit={choose}
      />
      {state.error && <Small role="alert">{state.error}</Small>}
      {command.message && <Small role="alert">{command.message}</Small>}
      {command.pending && (
        <Actions>
          <Button type="button" disabled={command.busy || disabled} onClick={() => void retry()}>
            Retry exact attachment change
          </Button>
          <Button type="button" disabled={command.busy} onClick={state.discard}>
            Discard unconfirmed attachment change
          </Button>
        </Actions>
      )}
    </>
  )
}

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`
const EditorPanel = styled(Panel)`
  display: grid;
  gap: 10px;
`

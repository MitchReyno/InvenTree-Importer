import { Notice, HeadingRow, Caption } from '../ui/primitives'
import { Button, Heading, Panel, Paragraph } from '../ui/primitives'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureWorkspaceProps } from '../../capture/types'
import styled from 'styled-components'
import { CaptureHeader } from './CaptureHeader'
import { CaptureQueue } from './CaptureQueue'
import { EvidencePanel } from './EvidencePanel'
import { CaptureEditor } from './CaptureEditor'
import { InstructionsPanel } from '../operator/InstructionsPanel'

export function CaptureWorkspace({
  batch,
  busy,
  media,
  edit,
  observe,
  onStage,
  onProcessing,
  onDirtyChange,
  operatorReview,
  operator,
  reload,
}: CaptureWorkspaceProps) {
  const [selected, select] = useState(() => location.hash.split('/')[1] || 'defaults')
  const [focused, setFocused] = useState(() => Boolean(location.hash.split('/')[1]))
  const [editorDirty, setDirty] = useState(false)
  const [mediaDirty, setMediaDirty] = useState(false)
  const [instructionsDirty, setInstructionsDirty] = useState(false)
  const dirtyFlags = useRef({ editor: false, media: false, instructions: false })
  const dirty = editorDirty || mediaDirty || instructionsDirty

  const reportMediaDirty = useCallback(
    (value: boolean) => {
      dirtyFlags.current.media = value
      setMediaDirty(value)
      onDirtyChange?.(anyDirty(dirtyFlags.current))
    },
    [onDirtyChange],
  )

  const reportInstructionsDirty = useCallback(
    (value: boolean) => {
      dirtyFlags.current.instructions = value
      setInstructionsDirty(value)
      onDirtyChange?.(anyDirty(dirtyFlags.current))
    },
    [onDirtyChange],
  )

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function reportDirty(value: boolean) {
    dirtyFlags.current.editor = value
    setDirty(value)
    onDirtyChange?.(anyDirty(dirtyFlags.current))
  }

  function setSelected(value: string) {
    select(value)
    setFocused(true)
    history.replaceState(null, '', `#${batch.id}/${value}`)
  }

  const lot = batch.lots.find((l) => l.id === selected)
  const part = batch.parts.find((p) => p.id === selected)
  const frozen = busy || batch.archived
  let title: string
  if (lot) {
    title = `Lot: ${lot.label}`
  } else if (part) {
    title = `Shared Part: ${part.label}`
  } else {
    title =
      {
        defaults: 'Batch defaults',
        add_lot: 'Add a physical lot',
        add_part: 'Add a shared Part proposal',
        batch: 'Batch title',
        note: 'Add human note',
      }[selected] ?? 'Capture'
  }

  return (
    <>
      <CaptureHeader
        batch={batch}
        busy={busy}
        dirty={dirty}
        edit={edit}
        onStage={onStage}
        onProcessing={onProcessing}
      />
      {batch.archived && (
        <Notice role="status">
          Archived, not deleted. History and original contributions are retained. Resume to edit.
        </Notice>
      )}
      <CaptureGrid $focused={focused}>
        <BackButton
          data-area="back"
          disabled={dirty}
          onClick={() => {
            setFocused(false)
            history.replaceState(null, '', `#${batch.id}`)
          }}
        >
          ← Lots and shared details{dirty ? ' · save or discard first' : ''}
        </BackButton>
        <CaptureQueue
          batch={batch}
          selected={selected}
          dirty={dirty}
          frozen={frozen || instructionsDirty}
          setSelected={setSelected}
        />

        <EvidencePanel
          batch={batch}
          selected={selected}
          dirty={editorDirty}
          navigationDirty={dirty}
          frozen={frozen || instructionsDirty}
          setSelected={setSelected}
          media={media}
          onMediaDirtyChange={reportMediaDirty}
        />
        <EditorPanel data-area="editor" aria-labelledby="editor-title">
          <HeadingRow>
            <Heading id="editor-title">{title}</Heading>
            <SelectionBadge $dirty={dirty}>
              {dirty ? 'Unsaved local input' : 'Human entered'}
            </SelectionBadge>
          </HeadingRow>
          <Caption>
            {dirty
              ? 'Save or discard before switching subjects.'
              : 'Saved values · not inferred or approved'}
          </Caption>
          {part && (
            <Notice>
              Affects {batch.lots.filter((l) => l.part_subject_id === part.id).length} lots. Sharing
              a Part does not combine their quantities or contribution identities.
            </Notice>
          )}
          {selected === 'defaults' && (
            <Paragraph>
              Changes apply only to inherited fields. Explicit choices, unknowns and clears stay
              unchanged.
            </Paragraph>
          )}
          <CaptureEditor
            key={selected}
            batch={batch}
            selected={selected}
            frozen={frozen || mediaDirty || instructionsDirty}
            dirty={editorDirty}
            onDirty={reportDirty}
            edit={edit}
            observe={observe}
          />
          {selected === 'defaults' && operator && operatorReview && reload && (
            <InstructionsPanel
              batch={batch}
              review={operatorReview}
              client={operator}
              media={media}
              disabled={frozen || editorDirty || mediaDirty}
              reload={reload}
              onDirtyChange={reportInstructionsDirty}
            />
          )}
        </EditorPanel>
      </CaptureGrid>
    </>
  )
}

function anyDirty(flags: { editor: boolean; media: boolean; instructions: boolean }) {
  return flags.editor || flags.media || flags.instructions
}

const CaptureGrid = styled.div<{ $focused: boolean }>`
  display: grid;
  grid-template-columns: minmax(200px, 0.8fr) minmax(260px, 1.3fr) minmax(330px, 1.35fr);
  grid-template-areas: 'queue context editor';
  gap: 12px;
  align-items: start;
  @media (max-width: 1000px) {
    grid-template-columns: minmax(190px, 0.7fr) minmax(0, 1.5fr);
    grid-template-areas: 'queue editor' 'queue context';
  }
  @media (max-width: 700px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: ${(p) => (p.$focused ? "'back' 'context' 'editor'" : "'queue'")};
    gap: 0;
    > [data-area='queue'] {
      display: ${(p) => (p.$focused ? 'none' : 'flex')};
    }
    > [data-area='context'],
    > [data-area='editor'] {
      display: ${(p) => (p.$focused ? 'block' : 'none')};
    }
    > [data-area='back'] {
      display: ${(p) => (p.$focused ? 'block' : 'none')};
    }
  }
`
const BackButton = styled(Button)`
  display: none;
  grid-area: back;
  justify-self: start;
  margin-bottom: 10px;
`
const EditorPanel = styled(Panel)`
  grid-area: editor;
`
const SelectionBadge = styled.span<{ $dirty: boolean }>`
  font-size: 12px;
  padding: 4px 7px;
  border-radius: 4px;
  background: ${(p) => (p.$dirty ? '#fff3d8' : '#edf3fc')};
  color: ${(p) => (p.$dirty ? '#644813' : '#164a93')};
`

import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { CaptureWorkspaceProps } from '../../capture/types'
import { Button, Notice } from '../ui/primitives'
import { BatchSettingsPanel } from './BatchSettingsPanel'
import { CaptureHeader } from './CaptureHeader'
import { EvidencePanel } from './EvidencePanel'

type DirtySource = 'settings' | 'media' | 'note'

/**
 * Capture is evidence on the left and Batch settings on the right, stacking on narrow screens.
 * Physical lots and Part proposals are edited in Review; their retained records are unchanged.
 */
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
  settings,
}: CaptureWorkspaceProps) {
  const dirtyFlags = useRef<Record<DirtySource, boolean>>({
    settings: false,
    media: false,
    note: false,
  })
  const [dirty, setDirty] = useState(false)
  const [sources, setSources] = useState<Record<DirtySource, boolean>>(dirtyFlags.current)

  // Batch rebuilds its ports and callbacks on every render; reporting must not depend on them.
  const latest = useRef({ onDirtyChange, settings })
  latest.current = { onDirtyChange, settings }
  const report = useCallback((source: DirtySource, value: boolean) => {
    const { onDirtyChange, settings } = latest.current
    const evidenceWasPending = dirtyFlags.current.media || dirtyFlags.current.note
    dirtyFlags.current = { ...dirtyFlags.current, [source]: value }
    const any = Object.values(dirtyFlags.current).some(Boolean)
    setSources(dirtyFlags.current)
    setDirty(any)
    onDirtyChange?.(any)
    // Evidence commands advance the batch revision; refresh it before settings resume.
    if (evidenceWasPending && !dirtyFlags.current.media && !dirtyFlags.current.note && settings) {
      settings.read().then(settings.accept, () => undefined)
    }
  }, [])
  const reportSettings = useCallback((value: boolean) => report('settings', value), [report])
  const reportMedia = useCallback((value: boolean) => report('media', value), [report])
  const reportNote = useCallback((value: boolean) => report('note', value), [report])

  useEffect(() => {
    latest.current.onDirtyChange?.(Object.values(dirtyFlags.current).some(Boolean))
  }, [onDirtyChange])
  useEffect(() => () => latest.current.onDirtyChange?.(false), [])

  const frozen = busy || batch.archived

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
      <CaptureGrid data-capture-grid>
        <EvidencePanel
          batch={batch}
          frozen={frozen || sources.settings}
          media={media}
          operator={operator}
          review={operatorReview}
          reload={reload}
          edit={edit}
          onMediaDirtyChange={reportMedia}
          onNoteDirtyChange={reportNote}
        />
        <SettingsColumn>
          <BatchSettingsPanel
            batch={batch}
            ports={settings}
            paused={sources.media || sources.note}
            operatorReview={operatorReview}
            onDirty={reportSettings}
            observe={observe}
            reload={reload}
          />
          {onStage && (
            <ReviewEntry type="button" onClick={() => onStage('review')}>
              Go to review →
            </ReviewEntry>
          )}
        </SettingsColumn>
      </CaptureGrid>
    </>
  )
}

const CaptureGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr);
  grid-template-areas: 'context settings';
  gap: 16px;
  align-items: start;
  @media (max-width: 860px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'context' 'settings';
  }
`
const SettingsColumn = styled.div`
  grid-area: settings;
  display: grid;
  gap: 12px;
  min-width: 0;
`
const ReviewEntry = styled(Button)`
  justify-self: stretch;
  text-align: left;
  font-weight: 550;
`

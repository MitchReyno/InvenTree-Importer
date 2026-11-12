import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type { CaptureWorkspaceProps } from '#/capture/types'
import { Banner, Button, media as breakpoints, useMediaQuery } from '#/components/ui'
import { BatchSettingsPanel } from './BatchSettingsPanel'
import { EvidencePanel } from './EvidencePanel'
import { ProposedLotsGlance } from './ProposedLotsGlance'
import { proposedLots } from '#/processing/proposed-lots'
import { batchHref } from '#/navigation/batch-route'
import { useSessionStatuses } from '#/processing/session-status'
import { useApiClients } from '#/context'
import { useBatchCommands } from '#/capture/batch-commands'

type DirtySource = 'settings' | 'media' | 'note'

/**
 * Capture is evidence on the left and Batch settings on the right, stacking on narrow screens.
 * Physical lots and Part proposals are edited in Review; their retained records are unchanged.
 */
export function CaptureWorkspace({
  batch,
  busy,
  onDirtyChange,
  operatorReview,
  settings,
}: CaptureWorkspaceProps) {
  const { observe, reload } = useBatchCommands()
  const { processing } = useApiClients()
  // The evidence card hosts the batch notes field, which Batch settings still owns and saves.
  const [notesTarget, setNotesTarget] = useState<HTMLElement | null>(null)
  const statuses = useSessionStatuses(processing, batch.id, batch.revision)
  const dirtyFlags = useRef<Record<DirtySource, boolean>>({
    settings: false,
    media: false,
    note: false,
  })
  const [sources, setSources] = useState<Record<DirtySource, boolean>>(dirtyFlags.current)

  // Batch rebuilds its ports and callbacks on every render; reporting must not depend on them.
  const latest = useRef({ onDirtyChange, settings })
  latest.current = { onDirtyChange, settings }
  const [refresh, setRefresh] = useState<'idle' | 'reading' | 'failed'>('idle')
  // Only the newest refresh may release or fail the gate; an older read is ignored.
  const refreshGeneration = useRef(0)
  const refreshSettings = useCallback(() => {
    const ports = latest.current.settings
    if (!ports) {
      return
    }
    const generation = ++refreshGeneration.current
    setRefresh('reading')
    ports.read().then(
      (snapshot) => {
        if (generation === refreshGeneration.current) {
          latest.current.settings?.accept(snapshot)
          setRefresh('idle')
        }
      },
      () => {
        if (generation === refreshGeneration.current) {
          setRefresh('failed')
        }
      },
    )
  }, [])
  const report = useCallback((source: DirtySource, value: boolean) => {
    const { onDirtyChange, settings } = latest.current
    const evidenceWasPending = dirtyFlags.current.media || dirtyFlags.current.note
    dirtyFlags.current = { ...dirtyFlags.current, [source]: value }
    const any = Object.values(dirtyFlags.current).some(Boolean)
    setSources(dirtyFlags.current)
    onDirtyChange?.(any)
    // Evidence commands advance the batch revision; settings stay paused until it is adopted.
    if (evidenceWasPending && !dirtyFlags.current.media && !dirtyFlags.current.note && settings) {
      refreshSettings()
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

  // On a phone the glance follows the capture tiles and settings collapse, as on the canvas.
  const phone = useMediaQuery(breakpoints.compact)
  // Moving the glance remounts its links, so focus on one returns to its twin after the move.
  const glanceBox = useRef<HTMLDivElement>(null)
  const glanceFocus = useRef<string | null>(null)

  const rememberGlanceFocus = (event: React.FocusEvent) => {
    glanceFocus.current = event.target.getAttribute('href')
  }

  const forgetGlanceFocus = (event: React.FocusEvent) => {
    if (event.relatedTarget) {
      glanceFocus.current = null
    }
  }

  useEffect(() => {
    const href = glanceFocus.current
    if (!href || document.activeElement !== document.body) {
      return
    }
    const twin = [...(glanceBox.current?.querySelectorAll('a') ?? [])].find(
      (link) => link.getAttribute('href') === href,
    )
    // A lot beyond the phone's first rows has no twin; the glance's first link takes focus.
    ;(twin ?? glanceBox.current?.querySelector('a'))?.focus()
  }, [phone])
  const glance = (
    <GlanceFocus ref={glanceBox} onFocus={rememberGlanceFocus} onBlur={forgetGlanceFocus}>
      <ProposedLotsGlance
        batchId={batch.id}
        lots={proposedLots(batch, operatorReview, NO_RETIRED_LOTS).map((lot) => ({
          ...lot,
          status: statuses.lots.get(lot.id),
        }))}
        leadStatus={statuses.lead}
        leadRunning={statuses.leadRunning}
        limit={phone ? 3 : undefined}
      />
    </GlanceFocus>
  )

  return (
    <>
      {batch.archived && (
        <ArchivedNote role="status">
          <Banner tone="plain">
            Archived, not deleted. History and original contributions are retained. Resume to edit.
          </Banner>
        </ArchivedNote>
      )}
      <CaptureGrid data-capture-grid>
        <EvidencePanel
          batch={batch}
          frozen={frozen || sources.settings}
          review={operatorReview}
          onMediaDirtyChange={reportMedia}
          onNoteDirtyChange={reportNote}
          notesSlot={setNotesTarget}
          afterActions={phone ? glance : undefined}
        />
        <SettingsColumn>
          {!phone && glance}
          {refresh === 'failed' && (
            <div role="alert">
              <Banner
                tone="bad"
                action={
                  <Button size="sm" onClick={refreshSettings}>
                    Refresh saved settings
                  </Button>
                }
              >
                Saved settings could not be refreshed after the evidence change, so settings stay
                paused.
              </Banner>
            </div>
          )}
          <BatchSettingsPanel
            batch={batch}
            ports={settings}
            paused={sources.media || sources.note || refresh !== 'idle'}
            operatorReview={operatorReview}
            onDirty={reportSettings}
            observe={observe}
            reload={reload}
            notesTarget={notesTarget}
            collapsible={phone}
          />
          <NextStep>
            <Button
              as="a"
              variant="primary"
              href={batchHref(batch.id, { tab: 'processing', step: 'overview' })}
            >
              Go to processing →
            </Button>
          </NextStep>
        </SettingsColumn>
      </CaptureGrid>
    </>
  )
}

// The glance hides lots the snapshot marks retired; Capture has no separate retired set.
const NO_RETIRED_LOTS: ReadonlySet<string> = new Set()

// The canvas's flex bases: evidence takes the room, and the columns stack when both no longer fit.
const CaptureGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[9]};
  align-items: flex-start;
  & > [data-area='context'] {
    flex: 999 1 600px;
  }
`
const SettingsColumn = styled.div`
  flex: 1 1 380px;
  display: grid;
  gap: ${space[6]};
  min-width: 0;
`
const ArchivedNote = styled.div`
  margin-bottom: ${space[8]};
`
const GlanceFocus = styled.div`
  display: contents;
`
const NextStep = styled.div`
  display: grid;
  & > a {
    justify-content: center;
  }
`

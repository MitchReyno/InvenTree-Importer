import type { CaptureSnapshotDto } from '@invimport/contracts'
import type { SettingsPorts } from '#/capture/types'
import type { ManualClient, ManualStage } from '#/manual/types'
import type { BatchRoute } from '#/navigation/batch-route'
import { CaptureWorkspace } from '#/components/capture/CaptureWorkspace'
import { ProcessingStage } from '#/components/processing/ProcessingStage'
import { ManualWorkspace } from '#/components/review/ManualWorkspace'
import { ReviewMapStage } from '#/components/review/ReviewMapStage'
import { RecordsStage } from '#/components/review/records/RecordsStage'
import { useApiClients } from '#/context'

/**
 * The tabs that can show a batch read-only while Capture's read is still landing. Processing,
 * Review › Lots and Records can use the session snapshot; Capture, the Map and Changes need the
 * whole batch, so only this tab's own cached read (`cached`) shows them.
 */
export function displaysRestored(route: BatchRoute | null, processing: unknown, cached: boolean) {
  if (route?.tab === 'processing') {
    return processing !== undefined
  }
  if (route?.tab === 'review' && (route.view === 'lots' || route.view === 'records')) {
    return true
  }
  return cached && route !== null
}

/** The open tab's retired lots, from the batch itself until the live reads land. */
function retiredLots(batch: CaptureSnapshotDto) {
  return new Set(batch.lots.filter((lot) => lot.retired).map((lot) => lot.id))
}

/**
 * The open tab drawn from restored snapshots, read-only: every command and edit is fenced, and the
 * live workspace replaces it once Capture's fresh read lands.
 */
export function RestoredTab({
  batch,
  route,
  focusLotId,
  manual,
  navigate,
  onDirtyChange,
  settings,
}: {
  batch: CaptureSnapshotDto
  route: BatchRoute
  /** A lot the Processing step address focuses. */
  focusLotId?: string | null
  manual: ManualClient
  navigate: (stage: ManualStage, resourceId?: string, options?: { replace?: boolean }) => void
  onDirtyChange: (dirty: boolean) => void
  /** Capture's settings, so its panel reads as it will; the inert wrapper keeps it from saving. */
  settings?: SettingsPorts
}) {
  const { processing, records } = useApiClients()
  if (route.tab === 'processing' && processing) {
    return (
      <ProcessingStage
        batch={batch}
        client={processing}
        step={route.step}
        questionId={'questionId' in route ? route.questionId : undefined}
        sessionPageJobId={'sessionJobId' in route ? route.sessionJobId : undefined}
        focusLotId={focusLotId}
        // The restored snapshot carries each lot's own retirement until the live reads land.
        retiredLotIds={retiredLots(batch)}
        onDirtyChange={onDirtyChange}
        displayOnly
      />
    )
  }
  if (route.tab === 'review' && route.view === 'records') {
    return <RecordsStage batch={batch} client={records} onDirtyChange={onDirtyChange} displayOnly />
  }
  if (route.tab === 'review' && route.view === 'map') {
    return (
      <ReviewMapStage
        batch={batch}
        retiredLotIds={retiredLots(batch)}
        restructureUnavailable
        onDirtyChange={onDirtyChange}
      />
    )
  }
  if (route.tab === 'capture') {
    return <CaptureWorkspace batch={batch} busy onDirtyChange={onDirtyChange} settings={settings} />
  }
  return (
    <ManualWorkspace
      batch={batch}
      client={manual}
      stage={changesStage(route)}
      // The pinned plan or run the address names, as the live workspace gets them.
      preparationId={
        route.tab === 'changes' && route.view === 'ready' ? route.preparationId : undefined
      }
      runId={route.tab === 'changes' && route.view === 'added' ? route.runId : undefined}
      navigate={navigate}
      onDirtyChange={onDirtyChange}
      displayOnly
    />
  )
}

function changesStage(route: BatchRoute): Exclude<ManualStage, 'capture'> {
  if (route.tab !== 'changes') {
    return 'review'
  }
  return route.view === 'ready' ? 'approve' : 'results'
}

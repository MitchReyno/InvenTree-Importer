import type { CaptureSnapshotDto } from '@invimport/contracts'
import type { ManualClient, ManualStage } from '#/manual/types'
import type { BatchRoute } from '#/navigation/batch-route'
import { ProcessingStage } from '#/components/processing/ProcessingStage'
import { ManualWorkspace } from '#/components/review/ManualWorkspace'
import { RecordsStage } from '#/components/review/records/RecordsStage'
import { useApiClients } from '#/context'

/** The tabs a reload can show from restored snapshots while Capture's read is still landing. */
export function displaysRestored(route: BatchRoute | null, processing: unknown) {
  if (route?.tab === 'processing') {
    return processing !== undefined
  }
  return route?.tab === 'review' && (route.view === 'lots' || route.view === 'records')
}

/**
 * The open tab drawn from restored snapshots, read-only: every command and edit is fenced, and the
 * live workspace replaces it once Capture's fresh read lands.
 */
export function RestoredTab({
  batch,
  route,
  manual,
  navigate,
  onDirtyChange,
}: {
  batch: CaptureSnapshotDto
  route: BatchRoute
  manual: ManualClient
  navigate: (stage: ManualStage, resourceId?: string, options?: { replace?: boolean }) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { processing, records } = useApiClients()
  if (route.tab === 'processing' && processing) {
    return (
      <ProcessingStage
        batch={batch}
        client={processing}
        step={route.step}
        questionId={route.questionId}
        onDirtyChange={onDirtyChange}
        displayOnly
      />
    )
  }
  if (route.tab === 'review' && route.view === 'records') {
    return <RecordsStage batch={batch} client={records} onDirtyChange={onDirtyChange} displayOnly />
  }
  return (
    <ManualWorkspace
      batch={batch}
      client={manual}
      stage="review"
      navigate={navigate}
      onDirtyChange={onDirtyChange}
      displayOnly
    />
  )
}

import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import { batchHref, type ProcessingStep } from '#/navigation/batch-route'
import type { ProcessingClient } from '#/processing/types'
import { ProcessingWorkspace } from './ProcessingWorkspace'
import type { SharperRequestStore } from './ExamineView'
import type { InstructionDelivery } from '#/processing/instruction-delivery'
import { useBatchCommands } from '#/context'
import type { DrawerRestoreStore } from '#/processing/drawer-restore'

interface Props {
  batch: CaptureSnapshotDto
  client: ProcessingClient
  step: ProcessingStep
  questionId?: string
  sessionId?: string | null
  /** The job whose session page the route names. */
  sessionPageJobId?: string
  /** A lot whose output the step opens in view, from the address. */
  focusLotId?: string | null
  /** The batch attention read the header counts from. */
  attention?: BatchAttentionDto
  /** The attention read failed, so Needs you cannot list everything the header counts. */
  attentionUnavailable?: boolean
  sharperRequests?: SharperRequestStore
  drawerRestore?: DrawerRestoreStore
  onDirtyChange: (dirty: boolean) => void
  /** Retired lots keep their job history but cannot start new attempts. */
  retiredLotIds?: ReadonlySet<string>
  instructions?: {
    text: string | undefined
    unavailable?: boolean
    instruct?: (text: string, revision: string, key: string) => Promise<unknown>
    /** Whether the saved instructions reached the agents, kept across Processing's remounts. */
    delivery?: InstructionDelivery
    /** Sends the saved instructions to the agents again. */
    deliver?: () => Promise<void>
  }
  /** Drawn from restored snapshots before Capture's read lands; nothing can be changed. */
  displayOnly?: boolean
}

export function ProcessingStage({
  batch,
  client,
  step,
  questionId,
  sessionId,
  sessionPageJobId,
  focusLotId,
  attention,
  attentionUnavailable,
  sharperRequests,
  drawerRestore,
  onDirtyChange,
  retiredLotIds,
  instructions,
  displayOnly,
}: Props) {
  const { edit, reload } = useBatchCommands()

  function navigateProcessing(view: ProcessingStep = 'overview', question?: string) {
    location.hash = batchHref(batch.id, { tab: 'processing', step: view, questionId: question })
  }

  return (
    <ProcessingWorkspace
      batch={batch}
      client={client}
      view={step}
      questionId={questionId}
      sessionId={sessionId}
      sessionPageJobId={sessionPageJobId}
      focusLotId={focusLotId}
      attention={attention}
      attentionUnavailable={attentionUnavailable}
      sharperRequests={sharperRequests}
      drawerRestore={drawerRestore}
      navigate={navigateProcessing}
      onDirtyChange={onDirtyChange}
      onSaved={reload}
      edit={edit}
      retiredLotIds={retiredLotIds}
      instructions={instructions}
      displayOnly={displayOnly}
    />
  )
}

import { useEffect } from 'react'
import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import { batchHref, type ProcessingStep } from '#/navigation/batch-route'
import type { ProcessingClient } from '#/processing/types'
import { ProcessingWorkspace } from './ProcessingWorkspace'
import type { SharperRequestStore } from './ExamineView'
import type { InstructionDelivery } from '#/processing/instruction-delivery'
import { useBatchCommands } from '#/capture/batch-commands'

interface Props {
  batch: CaptureSnapshotDto
  client: ProcessingClient
  step: ProcessingStep
  questionId?: string
  sessionId?: string | null
  sharperRequests?: SharperRequestStore
  onDirtyChange: (dirty: boolean) => void
  /** Retired lots keep their job history but cannot start new attempts. */
  retiredLotIds?: ReadonlySet<string>
  attention?: BatchAttentionDto
  unusedFiles?: number
  instructions?: {
    text: string | undefined
    unavailable?: boolean
    instruct?: (text: string, revision: string, key: string) => Promise<unknown>
    /** Whether the saved instructions reached the agents, kept across Processing's remounts. */
    delivery?: InstructionDelivery
    /** Sends the saved instructions to the agents again. */
    deliver?: () => Promise<void>
  }
}

export function ProcessingStage({
  batch,
  client,
  step,
  questionId,
  sessionId,
  sharperRequests,
  onDirtyChange,
  retiredLotIds,
  attention,
  unusedFiles,
  instructions,
}: Props) {
  const { edit, reload } = useBatchCommands()
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

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
      sharperRequests={sharperRequests}
      navigate={navigateProcessing}
      onDirtyChange={onDirtyChange}
      onSaved={reload}
      edit={edit}
      retiredLotIds={retiredLotIds}
      attention={attention}
      unusedFiles={unusedFiles}
      instructions={instructions}
    />
  )
}

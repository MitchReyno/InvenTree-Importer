import { useEffect } from 'react'
import type { BatchAttentionDto, CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import type { MediaClient } from '../../media/types'
import { batchHref, type ProcessingStep } from '../../navigation/batch-route'
import type { AgentsRead, ProcessingClient } from '../../processing/types'
import { ProcessingWorkspace } from './ProcessingWorkspace'
import type { SharperRequestStore } from './ExamineView'
import type { InstructionDelivery } from '../../processing/instruction-delivery'

interface Props {
  batch: CaptureSnapshotDto
  media?: MediaClient
  client: ProcessingClient
  step: ProcessingStep
  questionId?: string
  sessionId?: string | null
  sharperRequests?: SharperRequestStore
  reload: () => Promise<void>
  /** The batch's capture edit, for Examine's reading and region corrections. */
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
  onDirtyChange: (dirty: boolean) => void
  /** Retired lots keep their job history but cannot start new attempts. */
  retiredLotIds?: ReadonlySet<string>
  attention?: BatchAttentionDto
  agents?: AgentsRead
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
  media,
  step,
  questionId,
  sessionId,
  sharperRequests,
  reload,
  edit,
  onDirtyChange,
  retiredLotIds,
  attention,
  agents,
  unusedFiles,
  instructions,
}: Props) {
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  function navigateProcessing(view: ProcessingStep = 'overview', question?: string) {
    location.hash = batchHref(batch.id, { tab: 'processing', step: view, questionId: question })
  }

  return (
    <ProcessingWorkspace
      batch={batch}
      client={client}
      media={media}
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
      agents={agents}
      unusedFiles={unusedFiles}
      instructions={instructions}
    />
  )
}

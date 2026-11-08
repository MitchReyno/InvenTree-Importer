import { useEffect } from 'react'
import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import type { MediaClient } from '../../media/types'
import { batchHref, type ProcessingStep } from '../../navigation/batch-route'
import type { AgentsRead, ProcessingClient } from '../../processing/types'
import { ProcessingWorkspace } from './ProcessingWorkspace'

interface Props {
  batch: CaptureSnapshotDto
  media?: MediaClient
  client: ProcessingClient
  step: ProcessingStep
  questionId?: string
  sessionId?: string | null
  reload: () => Promise<void>
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
  }
}

export function ProcessingStage({
  batch,
  client,
  media,
  step,
  questionId,
  sessionId,
  reload,
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
      navigate={navigateProcessing}
      onDirtyChange={onDirtyChange}
      onSaved={reload}
      retiredLotIds={retiredLotIds}
      attention={attention}
      agents={agents}
      unusedFiles={unusedFiles}
      instructions={instructions}
    />
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import type { ManualStage } from '../../manual/types'
import type { ProcessingClient, ProcessingView } from '../../processing/types'
import { CaptureHeader } from '../capture/CaptureHeader'
import { ProcessingWorkspace } from './ProcessingWorkspace'

interface Props {
  batch: CaptureSnapshotDto
  client: ProcessingClient
  route: string
  disabled: boolean
  edit: (change: CaptureEditDto['change']) => Promise<void>
  navigate: (stage: ManualStage, resourceId?: string) => void
  reload: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

function selectedView(segment: string | undefined): ProcessingView {
  switch (segment) {
    case 'reading':
    case 'identifying':
    case 'research':
    case 'images':
    case 'inventory':
      return segment
    default:
      return 'overview'
  }
}

export function ProcessingStage({
  batch,
  client,
  route,
  disabled,
  edit,
  navigate,
  reload,
  onDirtyChange,
}: Props) {
  const [dirty, setDirty] = useState(false)
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value)
      onDirtyChange(value)
    },
    [onDirtyChange],
  )
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  function navigateProcessing(view: ProcessingView = 'overview', questionId?: string) {
    location.hash = `${batch.id}/processing/${view}${questionId ? `/${questionId}` : ''}`
  }

  const segments = route.split('/')
  return (
    <>
      <CaptureHeader
        batch={batch}
        busy={disabled}
        dirty={dirty}
        stage="processing"
        edit={edit}
        onStage={navigate}
        onProcessing={() => navigateProcessing()}
      />
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view={selectedView(segments[2])}
        questionId={segments[3]}
        navigate={navigateProcessing}
        onDirtyChange={reportDirty}
        onSaved={reload}
      />
    </>
  )
}

import { ErrorNotice } from '../ui/primitives'
import { Button, Paragraph, Summary } from '../ui/primitives'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { IntakeRequestError } from '@invimport/contracts/client'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  CaptureObservationDto,
} from '@invimport/contracts'
import type { Client } from '../../capture/client'
import { CaptureWorkspace } from '../capture/CaptureWorkspace'
import styled from 'styled-components'
import type { ManualClient, ManualStage } from '../../manual/types'
import type { ProcessingClient } from '../../processing/types'
import { ProcessingStage } from '../processing/ProcessingStage'
import { ManualWorkspace } from '../review/ManualWorkspace'

export function Batch({
  id,
  client,
  manual,
  processing,
  route,
  onDirtyChange,
}: {
  id: string
  client: Client
  manual: ManualClient
  processing?: ProcessingClient
  route: string
  onDirtyChange: (dirty: boolean) => void
}) {
  const segment = route.split('/')[1]
  const processingSelected = segment === 'processing' && processing !== undefined
  const stage: ManualStage =
    segment === 'review' || segment === 'approve' || segment === 'results' ? segment : 'capture'

  function navigate(value: ManualStage, resourceId?: string) {
    location.hash = value === 'capture' ? id : `${id}/${value}${resourceId ? `/${resourceId}` : ''}`
  }

  function openProcessing() {
    location.hash = `${id}/processing/overview`
  }

  const onProcessing = processing ? openProcessing : undefined

  const scope = useServerScope()
  const queryClient = useQueryClient()
  const queryKey = serverQueryKey(scope, 'capture', id)
  const captureQuery = useQuery({ queryKey, queryFn: () => client.read(id) })
  // This is accepted edit authority, not a mirror of the latest cache value.
  const [batch, setBatch] = useState<CaptureSnapshotDto | null>(null)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<CaptureSnapshotDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [reset, setReset] = useState(0)

  useEffect(() => {
    if (
      !batch &&
      captureQuery.isFetchedAfterMount &&
      captureQuery.isSuccess &&
      !captureQuery.isFetching
    ) {
      setBatch(captureQuery.data)
    }
  }, [
    batch,
    captureQuery.data,
    captureQuery.isFetchedAfterMount,
    captureQuery.isSuccess,
    captureQuery.isFetching,
  ])

  function acceptSavedBatch(value: CaptureSnapshotDto) {
    queryClient.setQueryData(queryKey, value)
    setBatch(value)
  }

  async function edit(change: CaptureEditDto['change']) {
    if (!batch) {
      return
    }
    setBusy(true)
    setError('')
    setCurrent(null)
    try {
      acceptSavedBatch(
        await client.edit(id, { expected_revision: batch.revision, change }, crypto.randomUUID()),
      )
    } catch (error) {
      if (error instanceof IntakeRequestError && error.status === 412) {
        setError(
          'Another client saved first. Your local input is preserved below and was not applied. Compare the current saved values before re-entering changes.',
        )
        try {
          setCurrent(await client.read(id))
        } catch {
          /* Remain stale; never silently rebase. */
        }
      } else {
        setError(
          'Save not confirmed. Your input is preserved. Reload saved values before deciding whether to submit again.',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function observe(
    model: 'part' | 'location',
    pk: string,
  ): Promise<CaptureObservationDto | null> {
    setBusy(true)
    setError('')
    try {
      const observed = await client.observe(id, { model, pk }, crypto.randomUUID())
      setBatch((b) =>
        b
          ? {
              ...b,
              observations: [...b.observations.filter((o) => o.id !== observed.id), observed],
            }
          : b,
      )
      return observed
    } catch {
      setError(
        'Inventory read unavailable or incomplete. No choice was selected. Check the fixed read target and try again.',
      )
      return null
    } finally {
      setBusy(false)
    }
  }

  async function reloadSavedValues() {
    try {
      const result = await captureQuery.refetch({ throwOnError: true })
      if (!result.data) {
        throw new Error('capture_snapshot_missing')
      }
      acceptSavedBatch(result.data)
      setReset((revision) => revision + 1)
      setCurrent(null)
      setError('')
    } catch {
      setError('Saved values still unavailable. Local inputs remain unchanged.')
    }
  }

  const readUnavailable = captureQuery.isError || captureQuery.fetchStatus === 'paused'
  const visibleError =
    error ||
    (readUnavailable ? 'Batch unavailable. Check connection and server-side target binding.' : '')
  const readOrCommandBusy = busy || captureQuery.isFetching

  let content: ReactNode
  if (batch && processingSelected) {
    content = (
      <ProcessingStage
        key={`${batch.id}:${batch.revision}:${reset}`}
        batch={batch}
        client={processing}
        route={route}
        disabled={readOrCommandBusy || readUnavailable}
        edit={edit}
        navigate={navigate}
        reload={reloadSavedValues}
        onDirtyChange={onDirtyChange}
      />
    )
  } else if (batch && stage !== 'capture') {
    content = (
      <ManualWorkspace
        key={`${batch.id}:${batch.revision}:${reset}`}
        batch={batch}
        client={manual}
        stage={stage}
        runId={stage === 'results' ? route.split('/')[2] : undefined}
        preparationId={stage === 'approve' ? route.split('/')[2] : undefined}
        edit={edit}
        navigate={navigate}
        reload={reloadSavedValues}
        onProcessing={onProcessing}
      />
    )
  } else if (batch) {
    content = (
      <CaptureWorkspace
        key={`${batch.id}:${batch.revision}:${reset}`}
        batch={batch}
        busy={readOrCommandBusy || readUnavailable}
        edit={edit}
        observe={observe}
        onStage={navigate}
        onProcessing={onProcessing}
        onDirtyChange={onDirtyChange}
      />
    )
  } else {
    content = !visibleError && <Paragraph role="status">Resuming saved batch…</Paragraph>
  }

  return (
    <>
      {visibleError && (
        <ErrorNotice role="alert">
          <Paragraph>{visibleError}</Paragraph>
          {current && (
            <>
              <Paragraph>
                <strong>Current saved title:</strong> {current.title} · revision {current.revision}
              </Paragraph>
              <details>
                <Summary>Current saved revision {current.revision} · exact fields</Summary>
                <SnapshotFields>
                  {JSON.stringify(
                    {
                      title: current.title,
                      defaults: current.defaults,
                      lots: current.lots,
                      parts: current.parts,
                    },
                    null,
                    2,
                  )}
                </SnapshotFields>
              </details>
            </>
          )}
          <Button
            disabled={readOrCommandBusy}
            onClick={() => {
              void reloadSavedValues()
            }}
          >
            Discard local edits and load saved values
          </Button>
        </ErrorNotice>
      )}
      {content}
    </>
  )
}

const SnapshotFields = styled.pre`
  overflow: auto;
  max-height: 300px;
  font-size: 12px;
`

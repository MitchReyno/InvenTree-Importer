import { ErrorNotice } from '../ui/primitives'
import { Button, Paragraph, Summary } from '../ui/primitives'
import { useEffect, useState } from 'react'
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
import { ManualWorkspace } from '../review/ManualWorkspace'

export function Batch({
  id,
  client,
  manual,
  route,
  onDirtyChange,
}: {
  id: string
  client: Client
  manual: ManualClient
  route: string
  onDirtyChange: (dirty: boolean) => void
}) {
  const segment = route.split('/')[1]
  const stage: ManualStage =
    segment === 'review' || segment === 'approve' || segment === 'results' ? segment : 'capture'

  function navigate(value: ManualStage, resourceId?: string) {
    location.hash = value === 'capture' ? id : `${id}/${value}${resourceId ? `/${resourceId}` : ''}`
  }

  const [batch, setBatch] = useState<CaptureSnapshotDto | null>(null)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<CaptureSnapshotDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [reset, setReset] = useState(0)
  useEffect(() => {
    let active = true
    void client
      .read(id)
      .then((value) => {
        if (active) {
          setBatch(value)
        }
      })
      .catch(() => {
        if (active) {
          setError('Batch unavailable. Check connection and server-side target binding.')
        }
      })
    return () => {
      active = false
    }
  }, [id, client])

  async function edit(change: CaptureEditDto['change']) {
    if (!batch) {
      return
    }
    setBusy(true)
    setError('')
    setCurrent(null)
    try {
      setBatch(
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
      const value = await client.read(id)
      setBatch(value)
      setReset((revision) => revision + 1)
      setCurrent(null)
      setError('')
    } catch {
      setError('Saved values still unavailable. Local inputs remain unchanged.')
    }
  }

  return (
    <>
      {error && (
        <ErrorNotice role="alert">
          <Paragraph>{error}</Paragraph>
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
            disabled={busy}
            onClick={() => {
              void reloadSavedValues()
            }}
          >
            Discard local edits and load saved values
          </Button>
        </ErrorNotice>
      )}
      {batch && stage !== 'capture' ? (
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
        />
      ) : batch ? (
        <CaptureWorkspace
          key={`${batch.id}:${batch.revision}:${reset}`}
          batch={batch}
          busy={busy}
          edit={edit}
          observe={observe}
          onStage={navigate}
          onDirtyChange={onDirtyChange}
        />
      ) : (
        !error && <Paragraph role="status">Resuming saved batch…</Paragraph>
      )}
    </>
  )
}

const SnapshotFields = styled.pre`
  overflow: auto;
  max-height: 300px;
  font-size: 12px;
`

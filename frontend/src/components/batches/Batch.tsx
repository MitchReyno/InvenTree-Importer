import { ErrorNotice } from '../ui/primitives'
import { Paragraph, Summary } from '../ui/primitives'
import { Button } from '../ui/Button'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import type { OperatorReviewClient } from '../../operator/types'
import { approvedLotIds, predecessorLotIds, retiredLotIds } from '../../operator/review-model'
import { unusedEvidenceCount } from '../../operator/review-map'
import { IntakeRequestError } from '@invimport/contracts/client'
import { validate } from '@invimport/contracts'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  CaptureObservationDto,
  MediaSnapshotDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import type { Client } from '../../capture/client'
import type { SettingsPorts } from '../../capture/types'
import type { CatalogueClient } from '../../catalogue/types'
import { useApplicationAvailable } from '../../capture/useApplicationAvailable'
import type { MediaClient } from '../../media/types'
import { CaptureWorkspace } from '../capture/CaptureWorkspace'
import styled from 'styled-components'
import { typeVar } from '../../theme/generated/tokens'
import type { ManualClient, ManualStage } from '../../manual/types'
import type { ProcessingClient } from '../../processing/types'
import { clearPending } from '../../processing/pending-messages'
import { ProcessingStage } from '../processing/ProcessingStage'
import { ManualWorkspace } from '../review/ManualWorkspace'
import { batchHref, parseBatchRoute, type BatchRoute } from '../../navigation/batch-route'
import { useBatchAttention, type AttentionClient } from '../../attention/useBatchAttention'
import { BatchHeader } from './BatchHeader'
import { PageContent } from '../AppLayout'
import { RecordsStage } from '../review/records/RecordsStage'
import type { RecordsClient } from '../../records/useBatchRecords'
import { ReviewMapStage } from '../review/ReviewMapStage'

/** The screen each Review and Changes route mounts until their redesigns replace them. */
function manualStage(route: BatchRoute | null): ManualStage {
  if (route?.tab === 'review' && route.view === 'lots') {
    return 'review'
  }
  if (route?.tab === 'changes') {
    return route.view === 'ready' ? 'approve' : 'results'
  }

  return 'capture'
}

function stageRoute(stage: ManualStage, resourceId?: string): BatchRoute {
  switch (stage) {
    case 'review':
      return resourceId
        ? { tab: 'review', view: 'lots', lotId: resourceId }
        : { tab: 'review', view: 'lots' }
    case 'approve':
      return resourceId
        ? { tab: 'changes', view: 'ready', preparationId: resourceId }
        : { tab: 'changes', view: 'ready' }
    case 'results':
      return resourceId
        ? { tab: 'changes', view: 'added', runId: resourceId }
        : { tab: 'changes', view: 'added' }
    default:
      return { tab: 'capture' }
  }
}

export function Batch({
  id,
  client,
  manual,
  processing,
  media,
  operator,
  catalogue,
  attention,
  records,
  route,
  onDirtyChange,
}: {
  id: string
  client: Client
  catalogue?: CatalogueClient
  manual: ManualClient
  processing?: ProcessingClient
  media?: MediaClient
  operator?: OperatorReviewClient
  attention?: AttentionClient
  records?: RecordsClient
  route: string
  onDirtyChange: (dirty: boolean) => void
}) {
  const parsed = parseBatchRoute(route)
  const batchRoute = parsed.kind === 'route' ? parsed.route : null
  const legacySubject = parsed.kind === 'route' ? parsed.legacySubject : undefined
  const processingSelected = batchRoute?.tab === 'processing' && processing !== undefined
  const stage = manualStage(batchRoute)

  // Old links move to their new routes; the navigation guard still blocks this with a dirty draft.
  const redirectTo = parsed.kind === 'redirect' ? parsed.to : null
  useEffect(() => {
    if (redirectTo) {
      location.replace(`#${redirectTo}`)
    }
  }, [redirectTo])

  // Remembered across tabs, which unmount the workspace, so bare Ready to add can return to it.
  const shownPreparation = useRef<string | null>(null)
  if (batchRoute?.tab === 'changes' && batchRoute.view === 'ready' && batchRoute.preparationId) {
    shownPreparation.current = batchRoute.preparationId
  }

  /** Automatic choices replace the entry, so Back never returns to a route that redirects. */
  function navigate(value: ManualStage, resourceId?: string, options?: { replace?: boolean }) {
    const href = batchHref(id, stageRoute(value, resourceId))
    if (options?.replace) {
      location.replace(href)
    } else {
      location.hash = href
    }
  }

  const pollInterval = useRetainedPollInterval()
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const queryKey = serverQueryKey(scope, 'capture', id)
  const captureQuery = useQuery({ queryKey, queryFn: () => client.read(id) })
  const operatorKey = serverQueryKey(scope, 'operator-review', id)
  const operatorQuery = useQuery({
    queryKey: operatorKey,
    queryFn: () => operator!.read(id),
    enabled: operator !== undefined,
    refetchInterval: pollInterval,
  })
  // This is accepted edit authority, not a mirror of the latest cache value.
  const [batch, setBatch] = useState<CaptureSnapshotDto | null>(null)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<CaptureSnapshotDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [reset, setReset] = useState(0)
  const [discarded, setDiscarded] = useState(0)
  const editPending = useRef(false)
  const editIntent = useRef<{ request: CaptureEditDto; key: string } | null>(null)

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

  // Autosave acknowledgements and reconnection reads may resolve out of order; keep the newest.
  function acceptNewerBatch(value: CaptureSnapshotDto) {
    setBatch((current) => {
      if (current && BigInt(current.revision) > BigInt(value.revision)) {
        return current
      }
      queryClient.setQueryData(queryKey, value)
      return value
    })
  }

  // Archive stays disabled while any screen holds an unsaved draft.
  const [draftDirty, setDraftDirty] = useState(false)
  const reportDirty = useCallback(
    (dirty: boolean) => {
      setDraftDirty(dirty)
      onDirtyChange(dirty)
    },
    [onDirtyChange],
  )
  const captureDirty = useRef(false)
  const reportCaptureDirty = useCallback(
    (dirty: boolean) => {
      captureDirty.current = dirty
      reportDirty(dirty)
    },
    [reportDirty],
  )

  // Former Capture subject links now open the same subject in Review.
  useEffect(() => {
    if (!batch || !legacySubject) {
      return
    }
    const lot = batch.lots.some((item) => item.id === legacySubject)
    const subject =
      lot ||
      batch.parts.some((item) => item.id === legacySubject) ||
      legacySubject === 'add_lot' ||
      legacySubject === 'add_part'
    if (subject) {
      location.replace(
        batchHref(
          id,
          lot
            ? { tab: 'review', view: 'lots', lotId: legacySubject }
            : { tab: 'review', view: 'lots' },
          `?edit=${encodeURIComponent(legacySubject)}`,
        ),
      )
    }
  }, [batch, id, legacySubject])

  // Capture follows newer saved values only while it holds no local edits.
  // Lots the Examine lead session forms appear live on Capture and Review. A screen holding an
  // unsaved draft keeps its revision; Review then offers the explicit reload instead.
  const reviewing = batchRoute?.tab === 'review'
  useEffect(() => {
    const latest = captureQuery.data
    const clean =
      (stage === 'capture' && !processingSelected && !captureDirty.current) ||
      (reviewing && !draftDirty)
    if (clean && batch && latest && BigInt(latest.revision) > BigInt(batch.revision)) {
      setBatch(latest)
    }
  }, [batch, captureQuery.data, processingSelected, stage, reviewing, draftDirty])

  async function edit(change: CaptureEditDto['change']): Promise<boolean> {
    if (!batch) {
      return false
    }
    const request = { expected_revision: batch.revision, change }
    try {
      validate('CaptureEdit', request)
    } catch {
      setError(
        'Check the entered values before saving. No request was sent for these values; the input remains editable. Any earlier unconfirmed save still needs reconciliation.',
      )
      return false
    }
    if (editPending.current) {
      return false
    }
    if (
      editIntent.current &&
      JSON.stringify(editIntent.current.request) !== JSON.stringify(request)
    ) {
      setError(
        'An earlier save is unconfirmed. Retry its unchanged input or reload saved values deliberately before submitting different changes.',
      )
      return false
    }
    editIntent.current ??= { request, key: crypto.randomUUID() }
    const intent = editIntent.current
    editPending.current = true
    setBusy(true)
    setError('')
    setCurrent(null)
    try {
      acceptSavedBatch(await client.edit(id, intent.request, intent.key))
      editIntent.current = null
      return true
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
      return false
    } finally {
      editPending.current = false
      setBusy(false)
    }
  }

  async function observe(
    model: import('@invimport/contracts').InventoryModelDto,
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

  /** Loads the saved batch; true when it was read. */
  async function reloadSavedValues() {
    if (editPending.current) {
      return false
    }
    void queryClient.invalidateQueries({ queryKey: operatorKey })
    try {
      const result = await captureQuery.refetch({ throwOnError: true })
      if (!result.data) {
        throw new Error('capture_snapshot_missing')
      }
      editIntent.current = null
      acceptSavedBatch(result.data)
      setReset((revision) => revision + 1)
      setCurrent(null)
      setError('')
      return true
    } catch {
      setError('Saved values still unavailable. Local inputs remain unchanged.')
      return false
    }
  }

  const reloadForStage = async () => {
    await reloadSavedValues()
  }

  /** Loads saved values and drops record drafts, which a plain reload keeps for a retry. */
  async function discardLocalEdits() {
    if (await reloadSavedValues()) {
      // Unsent Ask messages are record drafts, wherever the batch is shown.
      clearPending(`${id}:ask:`)
      setDiscarded((count) => count + 1)
    }
  }

  const [acceptedOperatorReview, setAcceptedOperatorReview] = useState<OperatorReviewDto>()
  const currentOperatorReview =
    batch &&
    operatorQuery.isFetchedAfterMount &&
    operatorQuery.isSuccess &&
    operatorQuery.fetchStatus !== 'paused' &&
    operatorQuery.data?.revision === batch.revision
      ? operatorQuery.data
      : undefined
  useEffect(() => {
    if (currentOperatorReview) {
      setAcceptedOperatorReview(currentOperatorReview)
    }
  }, [currentOperatorReview])
  // Keep draft owners mounted, but fence new commands when the latest projection is unavailable.
  const operatorReview =
    currentOperatorReview ??
    (acceptedOperatorReview?.revision === batch?.revision ? acceptedOperatorReview : undefined)
  const operatorUnavailable =
    operator !== undefined &&
    (!currentOperatorReview || operatorQuery.isError || operatorQuery.fetchStatus === 'paused')
  const retired = retiredLotIds(operatorReview, batch ?? undefined)
  const activeBatch = useMemo(
    () =>
      batch && retired.size
        ? { ...batch, lots: batch.lots.filter((lot) => !retired.has(lot.id)) }
        : batch,
    // Retirement comes from both the operator projection and capture history.
    [batch, operatorReview],
  )

  const attentionQuery = useBatchAttention(attention, id, batch?.revision)
  // Never fetches: the header reads the media snapshot Capture, the Map, Lots and Images hold,
  // so its counts match theirs and add no request.
  const mediaQuery = useQuery<MediaSnapshotDto>({
    queryKey: serverQueryKey(scope, 'media', id),
    queryFn: skipToken,
  })
  const predecessors = predecessorLotIds(currentOperatorReview ?? acceptedOperatorReview)
  const evidence = useMemo(
    () =>
      batch && mediaQuery.data
        ? {
            files: mediaQuery.data.evidence.length,
            unused: unusedEvidenceCount(batch, mediaQuery.data.evidence, retired, predecessors),
          }
        : undefined,
    // `retired` and `predecessors` follow the operator review.
    [batch, mediaQuery.data, currentOperatorReview, acceptedOperatorReview, operatorReview],
  )
  const readUnavailable = captureQuery.isError || captureQuery.fetchStatus === 'paused'
  const applicationAvailable = useApplicationAvailable(captureQuery.dataUpdatedAt, readUnavailable)
  const visibleError =
    error ||
    (readUnavailable ? 'Batch unavailable. Check connection and server-side target binding.' : '')
  const readOrCommandBusy = busy || captureQuery.isFetching

  const settingsPorts: SettingsPorts = {
    connected: applicationAvailable,
    save: (change, revision, key) => client.edit(id, { expected_revision: revision, change }, key),
    accept: acceptNewerBatch,
    read: () => client.read(id),
    instruct: operator
      ? (text, revision, key) =>
          operator.instruct(id, { expected_revision: revision, group_id: null, text }, key)
      : undefined,
    uploadLogo: media
      ? (file, label, revision, key) => media.upload(id, revision, label, file, key)
      : undefined,
    catalogue,
  }

  let content: ReactNode
  if (redirectTo) {
    content = null
  } else if (batch && processingSelected && batchRoute?.tab === 'processing') {
    content = (
      <ProcessingStage
        key={`${batch.id}:${batch.revision}:${reset}`}
        batch={batch}
        client={processing}
        media={media}
        step={batchRoute.step}
        questionId={batchRoute.questionId}
        reload={reloadForStage}
        onDirtyChange={reportDirty}
        retiredLotIds={retired}
        attention={attentionQuery.data}
        instructions={{
          // Undefined until the review projection for this revision is read.
          text: currentOperatorReview
            ? (currentOperatorReview.instructions.find((item) => item.group_id === null)?.text ??
              '')
            : undefined,
          unavailable: operatorQuery.isError || operatorQuery.fetchStatus === 'paused',
          instruct: settingsPorts.instruct
            ? async (text, revision, key) => {
                await settingsPorts.instruct?.(text, revision, key)
                await reloadSavedValues()
              }
            : undefined,
        }}
      />
    )
  } else if (batch && batchRoute?.tab === 'review' && batchRoute.view === 'records') {
    content = (
      <RecordsStage
        batch={batch}
        client={records}
        edit={edit}
        observe={observe}
        onDirtyChange={reportDirty}
        reload={reloadSavedValues}
        discarded={discarded}
        initialType={batchRoute.recordType}
        initialRecord={batchRoute.recordId}
        processing={processing}
      />
    )
  } else if (batch && batchRoute?.tab === 'review' && batchRoute.view === 'map') {
    content = (
      <ReviewMapStage
        batch={batch}
        media={media}
        edit={edit}
        operator={operator}
        retiredLotIds={retired}
        predecessors={predecessors}
        restructureUnavailable={operatorUnavailable}
        approvedLotIds={approvedLotIds(currentOperatorReview, acceptedOperatorReview)}
        reload={reloadForStage}
        onDirtyChange={reportDirty}
        processing={processing}
      />
    )
  } else if (batch && stage !== 'capture') {
    content = (
      <ManualWorkspace
        key={`${batch.id}:${batch.revision}:${reset}`}
        batch={batch}
        client={manual}
        stage={stage}
        runId={
          batchRoute?.tab === 'changes' && batchRoute.view === 'added'
            ? batchRoute.runId
            : undefined
        }
        preparationId={
          batchRoute?.tab === 'changes' && batchRoute.view === 'ready'
            ? batchRoute.preparationId
            : undefined
        }
        edit={edit}
        observe={observe}
        navigate={navigate}
        rememberedPreparationId={shownPreparation.current}
        reload={reloadForStage}
        operatorReview={currentOperatorReview}
        operator={operator}
        media={media}
        processing={processing}
        onDirtyChange={reportDirty}
      />
    )
  } else if (batch && activeBatch) {
    content = (
      <CaptureWorkspace
        key={`${batch.id}:${reset}`}
        batch={activeBatch}
        operatorReview={operatorReview}
        operator={operator}
        reload={reloadForStage}
        media={media}
        busy={
          readOrCommandBusy ||
          readUnavailable ||
          (acceptedOperatorReview !== undefined && operatorUnavailable)
        }
        edit={edit}
        observe={observe}
        onStage={navigate}
        onDirtyChange={reportCaptureDirty}
        settings={settingsPorts}
        processing={processing}
      />
    )
  } else {
    content = !visibleError && <Paragraph role="status">Resuming saved batch…</Paragraph>
  }

  return (
    <>
      {batch && batchRoute && (
        <BatchHeader
          batch={batch}
          route={batchRoute}
          attention={attentionQuery.data}
          attentionUnavailable={attentionQuery.isError}
          evidence={evidence}
          activeLotCount={batch.lots.length - retired.size}
          retiredLotCount={retired.size}
          busy={readOrCommandBusy || readUnavailable || draftDirty}
          onArchive={() => void edit({ kind: 'batch', archived: !batch.archived })}
        />
      )}
      <PageContent $width={batchRoute?.tab === 'review' ? 'review' : 'content'}>
        {operatorUnavailable && acceptedOperatorReview && !visibleError && (
          <ErrorNotice role="status">
            <Paragraph>
              Current operator review is unavailable or changed. Local input is retained until exact
              retry or explicit discard.
            </Paragraph>
            <Button
              disabled={busy || captureQuery.isFetching}
              onClick={() => void discardLocalEdits()}
            >
              Discard local edits and load saved values
            </Button>
          </ErrorNotice>
        )}
        {visibleError && (
          <ErrorNotice role="alert">
            <Paragraph>{visibleError}</Paragraph>
            {current && (
              <>
                <Paragraph>
                  <strong>Current saved title:</strong> {current.title} · revision{' '}
                  {current.revision}
                </Paragraph>
                <details>
                  <Summary>Current saved revision {current.revision} · exact fields</Summary>
                  <SnapshotFields>
                    {JSON.stringify(
                      {
                        title: current.title,
                        defaults: current.defaults,
                        context: current.context,
                        notes: current.notes,
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
                void discardLocalEdits()
              }}
            >
              Discard local edits and load saved values
            </Button>
          </ErrorNotice>
        )}
        {content}
      </PageContent>
    </>
  )
}

const SnapshotFields = styled.pre`
  overflow: auto;
  max-height: 300px;
  font-size: ${typeVar.mono.size};
`

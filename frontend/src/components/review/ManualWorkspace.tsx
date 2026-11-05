import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import type {
  CaptureSnapshotDto,
  CaptureEditDto,
  ManualPreviewDto,
  ManualRunDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import type { MediaClient } from '../../media/types'
import type { ProcessingClient } from '../../processing/types'
import type { OperatorReviewClient } from '../../operator/types'
import { IntakeRequestError } from '@invimport/contracts/client'
import type { ManualClient, ManualStage, RunRecoverySelection } from '../../manual/types'
import { useDirtySources } from '../../operator/useDirtySources'
import {
  Button,
  ErrorNotice,
  Notice,
  Paragraph,
  Small,
  Heading,
  HeadingRow,
} from '../ui/primitives'
import { ReviewWorkspace } from './ReviewWorkspace'
import type { CaptureWorkspaceProps } from '../../capture/types'
import { ApprovalWorkspace } from './ApprovalWorkspace'
import { ResultsWorkspace } from '../results/ResultsWorkspace'

const MAX_SELECTED_LOTS = 10

interface Props {
  batch: CaptureSnapshotDto
  client: ManualClient
  stage: Exclude<ManualStage, 'capture'>
  runId?: string
  preparationId?: string
  /** The preparation last shown in this batch, which bare Ready to add returns to. */
  rememberedPreparationId?: string | null
  edit: (change: CaptureEditDto['change']) => Promise<boolean | void>
  observe?: CaptureWorkspaceProps['observe']
  navigate: (stage: ManualStage, resourceId?: string, options?: { replace?: boolean }) => void
  reload: () => Promise<void>
  /** Present only when its revision matches `batch`; stale projections are not shown. */
  operatorReview?: OperatorReviewDto
  operator?: OperatorReviewClient
  media?: MediaClient
  processing?: ProcessingClient
  onDirtyChange?: (dirty: boolean) => void
}

function commandMessage(error: unknown) {
  if (error instanceof IntakeRequestError) {
    const messages: Record<string, string> = {
      stale_preparation:
        'Selected facts or review changed. Return to Review and prepare the current effects.',
      revision_conflict:
        'Saved state changed. Inspect the current snapshot before submitting another command.',
      source_history_unsettled:
        'An earlier original run blocks this source. Inspect its retained results.',
      original_contribution_already_approved:
        'This contribution already has an approval. Use its original run; never create replacement stock.',
      create_not_recoverable: 'This operation cannot safely resume. Inspect the original outcome.',
    }
    return (
      messages[error.code] ??
      'The command was not accepted. Inspect current review or original-run results.'
    )
  }
  return 'The command outcome is not confirmed. Refresh retained results before deciding what to do next.'
}

export function ManualWorkspace({
  batch,
  client,
  stage,
  runId,
  preparationId,
  rememberedPreparationId,
  edit,
  observe,
  navigate,
  reload,
  operatorReview,
  operator,
  media,
  processing,
  onDirtyChange,
}: Props) {
  const pollInterval = useRetainedPollInterval()
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const mediaQuery = useQuery({
    queryKey: serverQueryKey(scope, 'media', batch.id),
    queryFn: () => media!.snapshot(batch.id),
    enabled: stage === 'review' && media !== undefined,
    refetchInterval: pollInterval,
  })
  const processingQuery = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batch.id),
    queryFn: () => processing!.read(batch.id),
    enabled: stage === 'review' && processing !== undefined,
    refetchInterval: pollInterval,
  })
  const workspaceQuery = useQuery({
    queryKey: serverQueryKey(scope, 'manual', batch.id),
    queryFn: () => client.workspace(batch.id),
    refetchInterval: pollInterval,
  })
  const workspace = workspaceQuery.data
  const connectionLost = workspaceQuery.isError || workspaceQuery.fetchStatus === 'paused'
  const waitingForFirstRead = !workspaceQuery.isFetchedAfterMount
  const drafts = useDirtySources(onDirtyChange)
  const [selected, setSelected] = useState<string[]>([])
  const [lastPreview, setLastPreview] = useState<ManualPreviewDto | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    const result = await workspaceQuery.refetch({ throwOnError: true })
    if (!result.data) {
      throw new Error('manual_snapshot_missing')
    }

    return result.data
  }

  useEffect(() => {
    if (!workspace) {
      return
    }

    // A retained approval removes a row from a transient review selection, not from history.
    setSelected((previous) =>
      previous.filter((id) =>
        workspace.lots.some(
          (lot) =>
            lot.lot_id === id &&
            !lot.issues.some(
              (problem) => problem.code === 'original_contribution_already_approved',
            ),
        ),
      ),
    )
  }, [workspace])

  useEffect(() => {
    if (!workspace || stage !== 'approve') {
      return
    }
    if (preparationId) {
      const matching = workspace.preparations.find((value) => value.id === preparationId)
      if (matching && matching !== lastPreview) {
        setLastPreview(matching)
      }
      return
    }
    // Bare Ready to add opens the remembered preparation, or the newest once that is gone,
    // judged by this mount's own successful read rather than a cached one.
    if (waitingForFirstRead || connectionLost) {
      return
    }
    const shown =
      workspace.preparations.find((value) => value.id === rememberedPreparationId) ??
      workspace.preparations[0]
    if (shown) {
      setLastPreview(shown)
      navigate('approve', shown.id, { replace: true })
    }
  }, [
    workspace,
    waitingForFirstRead,
    connectionLost,
    stage,
    preparationId,
    rememberedPreparationId,
    lastPreview,
    navigate,
  ])
  const displayedPreview = preparationId
    ? (workspace?.preparations.find((value) => value.id === preparationId) ??
      (lastPreview?.id === preparationId ? lastPreview : null))
    : null

  function choosePreparation(value: ManualPreviewDto) {
    setLastPreview(value)
    navigate('approve', value.id)
  }

  const stale = workspace ? workspace.revision !== batch.revision : true

  async function perform(label: string, work: () => Promise<void>) {
    setBusy(label)
    setError('')
    try {
      await work()
    } catch (error) {
      setError(commandMessage(error))
    }

    void queryClient.invalidateQueries({
      queryKey: serverQueryKey(scope, 'operator-review', batch.id),
    })
    try {
      await refresh()
    } catch {
      // A failed status read must not relabel a confirmed command as an unknown command.
      // The query retains its last snapshot and reports the unavailable read separately.
    } finally {
      setBusy('')
    }
  }

  function toggle(id: string) {
    setSelected((previous) => {
      if (previous.includes(id)) {
        return previous.filter((value) => value !== id)
      }
      if (previous.length >= MAX_SELECTED_LOTS) {
        return previous
      }

      return [...previous, id]
    })
  }

  function reviewLots(ids: string[]) {
    void perform('Retaining exact review…', async () => {
      await client.review(
        batch.id,
        { expected_batch_revision: batch.revision, selected_lot_ids: ids },
        crypto.randomUUID(),
      )
    })
  }

  function review() {
    reviewLots(selected)
  }

  function prepare() {
    void perform('Reading the fixed target and preparing selected effects…', async () => {
      const result = await client.prepare(
        batch.id,
        { expected_batch_revision: batch.revision, selected_lot_ids: selected },
        crypto.randomUUID(),
      )
      if (result.status === 'blocked') {
        setError(result.issues.map((value) => value.message).join(' '))
        return
      }
      setLastPreview(result.preparation)
      navigate('approve', result.preparation.id)
    })
  }

  function approve() {
    if (!displayedPreview) {
      return
    }
    const exact = displayedPreview
    void perform('Retaining exact approval…', async () => {
      const accepted = await client.approve(
        {
          preparation_id: exact.id,
          expected_plan_sha256: exact.plan_sha256,
          expected_review_fingerprint: exact.review_fingerprint,
          selected_lot_ids: exact.selected_lot_ids,
          expected_target_revision: exact.target_revision,
        },
        crypto.randomUUID(),
      )
      setLastPreview(null)
      navigate('results', accepted.run_id)
    })
  }

  function command(
    run: ManualRunDto,
    action: 'start' | 'cancel' | 'recover',
    selection?: RunRecoverySelection,
  ) {
    void perform('Retaining original-run command…', async () => {
      const input = { expected_run_revision: run.revision }
      if (action === 'recover') {
        await client.recover(
          run.run_id,
          selection?.kind === 'effect'
            ? { ...input, effect_keys: selection.keys }
            : selection?.kind === 'assessment'
              ? { ...input, assessment_keys: selection.keys }
              : selection?.kind === 'attachment'
                ? { ...input, attachment_keys: selection.keys }
                : { ...input, operation_keys: selection?.keys ?? [] },
          crypto.randomUUID(),
        )
      } else {
        await client[action](run.run_id, input, crypto.randomUUID())
      }
    })
  }

  const disabled = Boolean(busy) || connectionLost || waitingForFirstRead
  let content: ReactNode
  if (!workspace) {
    content = <Paragraph role="status">Reading retained manual workflow…</Paragraph>
  } else if (stage === 'review') {
    content = (
      <ReviewWorkspace
        batch={batch}
        workspace={workspace}
        operatorReview={operatorReview}
        operator={operator}
        media={mediaQuery.data}
        mediaUnavailable={mediaQuery.isError || mediaQuery.fetchStatus === 'paused'}
        mediaLoading={media !== undefined && mediaQuery.isPending}
        processing={processingQuery.data}
        // Cached data is history: acceptance needs this mount's successful read at this revision.
        processingCurrent={
          processingQuery.isFetchedAfterMount &&
          processingQuery.status === 'success' &&
          !processingQuery.isRefetchError &&
          !processingQuery.isFetching &&
          processingQuery.data?.capture_revision === batch.revision
        }
        selected={selected}
        maxSelected={MAX_SELECTED_LOTS}
        busy={disabled}
        stale={stale}
        toggle={toggle}
        review={review}
        reviewLots={reviewLots}
        prepare={prepare}
        edit={edit}
        reload={reload}
        observe={observe}
        mediaClient={media}
        onDirtyChange={drafts.forSource('review')}
      />
    )
  } else if (stage === 'approve') {
    content = (
      <ApprovalWorkspace
        batch={batch}
        preparations={workspace.preparations}
        preview={displayedPreview}
        busy={disabled}
        choose={choosePreparation}
        pinnedPreparationId={preparationId}
        approve={approve}
        review={() => navigate('review')}
      />
    )
  } else {
    content = (
      <ResultsWorkspace
        batchId={batch.id}
        runs={workspace.runs}
        focusedRunId={runId}
        busy={disabled}
        command={command}
      />
    )
  }
  return (
    <>
      <HeadingRow>
        <Heading>
          {
            {
              review: 'Review selected lots',
              approve: 'Approve exact effects',
              results: 'Retained results',
            }[stage]
          }
        </Heading>
        <Small>Owned fake only</Small>
      </HeadingRow>
      {workspace?.preparations_truncated && (
        <Notice>
          Only the 20 most recent unapproved preparations are considered here. Older exact plans
          remain retained; prepare current scope again if needed.
        </Notice>
      )}
      {busy && <Notice role="status">{busy}</Notice>}
      {workspace && waitingForFirstRead && !connectionLost && (
        <Notice role="status">Verifying current retained state; commands are disabled.</Notice>
      )}
      {(connectionLost || error) && (
        <ErrorNotice role="alert">
          {connectionLost && (
            <Paragraph>
              Status unavailable. Showing the last retained snapshot; commands are disabled until
              the application can verify current state.
            </Paragraph>
          )}
          {error && <Paragraph>{error}</Paragraph>}
          <Button
            disabled={Boolean(busy)}
            onClick={() => {
              void refresh().catch(() => undefined)
            }}
          >
            Refresh retained state
          </Button>
        </ErrorNotice>
      )}
      {stale && workspace && (
        <Notice>
          Saved capture changed in another client. Your review display has not silently changed.
          <br />
          <Button
            disabled={Boolean(busy)}
            onClick={() => {
              void reload()
            }}
          >
            Load current saved choices
          </Button>
        </Notice>
      )}
      {content}
    </>
  )
}

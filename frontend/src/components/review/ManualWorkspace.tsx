import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  CaptureSnapshotDto,
  CaptureEditDto,
  ManualPreviewDto,
  ManualRunDto,
  ManualWorkspaceDto,
} from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import type { ManualClient, ManualStage } from '../../manual/types'
import { CaptureHeader } from '../capture/CaptureHeader'
import { Button, ErrorNotice, Notice, Paragraph, Small, Heading } from '../ui/primitives'
import { ReviewWorkspace } from './ReviewWorkspace'
import { ApprovalWorkspace } from './ApprovalWorkspace'
import { ResultsWorkspace } from '../results/ResultsWorkspace'

interface Props {
  batch: CaptureSnapshotDto
  client: ManualClient
  stage: Exclude<ManualStage, 'capture'>
  runId?: string
  preparationId?: string
  edit: (change: CaptureEditDto['change']) => Promise<void>
  navigate: (stage: ManualStage, resourceId?: string) => void
  reload: () => Promise<void>
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
  edit,
  navigate,
  reload,
}: Props) {
  const [workspace, setWorkspace] = useState<ManualWorkspaceDto | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [lastPreview, setLastPreview] = useState<ManualPreviewDto | null>(null)
  const initialChoiceMade = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [connectionLost, setConnectionLost] = useState(false)

  async function refresh() {
    const value = await client.workspace(batch.id)
    setWorkspace(value)
    setConnectionLost(false)
    setSelected((previous) =>
      previous.filter((id) =>
        value.lots.some(
          (lot) =>
            lot.lot_id === id &&
            !lot.issues.some(
              (problem) => problem.code === 'original_contribution_already_approved',
            ),
        ),
      ),
    )
    return value
  }

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const value = await client.workspace(batch.id)
        if (active) {
          setWorkspace(value)
          setConnectionLost(false)
          setSelected((previous) =>
            previous.filter((id) =>
              value.lots.some(
                (lot) =>
                  lot.lot_id === id &&
                  !lot.issues.some(
                    (problem) => problem.code === 'original_contribution_already_approved',
                  ),
              ),
            ),
          )
        }
      } catch {
        if (active) {
          setConnectionLost(true)
        }
      } finally {
        if (active) {
          timer = setTimeout(() => {
            void poll()
          }, 2000)
        }
      }
    }

    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [batch.id, client])
  useEffect(() => {
    if (!workspace || stage !== 'approve') {
      return
    }
    if (preparationId) {
      initialChoiceMade.current = true
      const matching = workspace.preparations.find((value) => value.id === preparationId)
      if (matching && matching !== lastPreview) {
        setLastPreview(matching)
      }
    } else if (!initialChoiceMade.current) {
      initialChoiceMade.current = true
      const first = workspace.preparations[0]
      if (first) {
        setLastPreview(first)
        navigate('approve', first.id)
      }
    }
  }, [workspace, stage, preparationId, lastPreview, navigate])
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
      await refresh()
    } catch (error) {
      setError(commandMessage(error))
      try {
        await refresh()
      } catch {
        setConnectionLost(true)
      }
    } finally {
      setBusy('')
    }
  }

  function toggle(id: string) {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : previous.length < 10
          ? [...previous, id]
          : previous,
    )
  }

  function review() {
    void perform('Retaining exact review…', async () => {
      await client.review(
        batch.id,
        { expected_batch_revision: batch.revision, selected_lot_ids: selected },
        crypto.randomUUID(),
      )
    })
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
    operationKeys?: string[],
  ) {
    void perform('Retaining original-run command…', async () => {
      const input = { expected_run_revision: run.revision }
      if (action === 'recover') {
        await client.recover(
          run.run_id,
          { ...input, operation_keys: operationKeys ?? [] },
          crypto.randomUUID(),
        )
      } else {
        await client[action](run.run_id, input, crypto.randomUUID())
      }
    })
  }

  const disabled = Boolean(busy) || connectionLost
  let content: ReactNode
  if (!workspace) {
    content = <Paragraph role="status">Reading retained manual workflow…</Paragraph>
  } else if (stage === 'review') {
    content = (
      <ReviewWorkspace
        batch={batch}
        workspace={workspace}
        selected={selected}
        busy={disabled}
        stale={stale}
        toggle={toggle}
        review={review}
        prepare={prepare}
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
      <CaptureHeader
        batch={batch}
        busy={Boolean(busy)}
        dirty={false}
        edit={edit}
        stage={stage}
        onStage={(value) =>
          navigate(value, value === 'approve' ? (preparationId ?? lastPreview?.id) : undefined)
        }
      />
      <Small>
        Manual workflow · owned fake only. Processing, uploads and research remain unavailable.
      </Small>
      <Heading>
        {stage === 'review'
          ? 'Review selected lots'
          : stage === 'approve'
            ? 'Approve exact effects'
            : 'Retained results'}
      </Heading>
      {workspace?.preparations_truncated && (
        <Notice>
          Only the 20 most recent unapproved preparations are considered here. Older exact plans
          remain retained; prepare current scope again if needed.
        </Notice>
      )}
      {busy && <Notice role="status">{busy}</Notice>}
      {connectionLost && (
        <ErrorNotice role="alert">
          Status unavailable. Showing the last retained snapshot; commands are disabled until the
          application can verify current state.
        </ErrorNotice>
      )}
      {error && (
        <ErrorNotice role="alert">
          <Paragraph>{error}</Paragraph>
          <Button
            disabled={Boolean(busy)}
            onClick={() => {
              void refresh().catch(() => setConnectionLost(true))
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

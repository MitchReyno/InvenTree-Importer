import { focusManager, onlineManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey } from './queries/scope'
import { fixtureScope } from './test/render'
import { render } from './test/render'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import {
  validate,
  type CaptureSnapshotDto,
  type ManualWorkspaceDto,
  type ManualPreviewDto,
  type ManualRunDto,
} from '@invimport/contracts'
import type { ManualClient } from './manual/types'
import { ManualWorkspace } from './components/review/ManualWorkspace'
import { ResultsWorkspace } from './components/results/ResultsWorkspace'
import { ActivityIndicator } from './components/ui/ActivityIndicator'

const batchId = '10000000-0000-4000-8000-000000000001'
const partId = '20000000-0000-4000-8000-000000000002'
const a = '30000000-0000-4000-8000-000000000003'
const b = '30000000-0000-4000-8000-000000000004'
const source = '40000000-0000-4000-8000-000000000004'
const actor = '50000000-0000-4000-8000-000000000005'
const context = '60000000-0000-4000-8000-000000000006'
const stream = '90000000-0000-4000-8000-000000000009'
const prep = 'a0000000-0000-4000-8000-000000000001'
const runId = 'b0000000-0000-4000-8000-000000000002'
const approvalId = 'c0000000-0000-4000-8000-000000000003'
const observedPart = 'd0000000-0000-4000-8000-000000000004'
const observedLocation = 'e0000000-0000-4000-8000-000000000005'
const batch: CaptureSnapshotDto = {
  id: batchId,
  source_id: source,
  title: 'Distinct physical packets',
  revision: '9007199254740993',
  archived: false,
  updated_at: '2026-11-01T12:00:00Z',
  actor_id: actor,
  target_context_id: context,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [
    {
      id: partId,
      label: 'Shared resistor',
      revision: '2',
      choice: {
        mode: 'set',
        value: {
          observation_id: observedPart,
          target_context_id: context,
          model: 'part',
          pk: '29',
        },
      },
    },
  ],
  lots: [
    {
      id: a,
      label: 'Packet A',
      revision: '3',
      contribution_key: '70000000-0000-4000-8000-000000000007',
      part_subject_id: partId,
      quantity: { mode: 'set', value: '0.000001' },
      location: {
        mode: 'set',
        value: {
          observation_id: observedLocation,
          target_context_id: context,
          model: 'location',
          pk: '43',
        },
      },
    },
    {
      id: b,
      label: 'Packet B',
      revision: '4',
      contribution_key: '80000000-0000-4000-8000-000000000008',
      part_subject_id: partId,
      quantity: { mode: 'set', value: '23' },
      location: { mode: 'clear' },
    },
  ],
  notes: [
    {
      id: 'f0000000-0000-4000-8000-000000000006',
      subject_id: a,
      text: 'Human count; do not merge packets.',
      actor_id: actor,
      created_at: '2026-11-01T12:00:00Z',
      producer: 'human',
    },
  ],
  observations: [
    {
      id: observedPart,
      model: 'part',
      pk: '29',
      target_context_id: context,
      label: '100 Ω resistor',
      observed_at: '2026-11-01T12:00:00Z',
    },
    {
      id: observedLocation,
      model: 'location',
      pk: '43',
      target_context_id: context,
      label: 'Drawer 4',
      observed_at: '2026-11-01T12:00:00Z',
    },
  ],
  cursor: { stream_id: stream, sequence: '7' },
}
const preview: ManualPreviewDto = {
  id: prep,
  batch_id: batchId,
  selected_lot_ids: [a],
  remaining_lot_ids: [b],
  plan_sha256: 'a'.repeat(64),
  review_fingerprint: 'b'.repeat(64),
  target_revision: '3',
  capability: 'owned-fake-stock/1',
  effects: [
    {
      lot_id: a,
      lot_label: 'Packet A',
      part_id: '29',
      part_label: '100 Ω resistor',
      quantity: '0.000001',
      location_id: '43',
      location_label: 'Drawer 4',
      contribution_key: batch.lots[0].contribution_key,
      barcode: `bi1:${source}:${batch.lots[0].contribution_key}`,
    },
  ],
}
const run: ManualRunDto = {
  run_id: runId,
  approval_id: approvalId,
  preparation_id: prep,
  batch_id: batchId,
  round_number: '1',
  revision: '5',
  state: 'queued',
  effect_certainty: 'none',
  confirmed_stock_ids: [],
  attributed_stock_ids: [],
  cancellation_requested: false,
  dispatch_state: 'not_requested',
  operations: [
    {
      operation_key: a,
      lot_id: a,
      lot_label: 'Packet A',
      quantity: '0.000001',
      certainty: 'none',
      remote_pk: null,
      recovery_allowed: false,
    },
  ],
  cursor: { stream_id: stream, sequence: '10' },
}

function checked<T>(schema: Parameters<typeof validate>[0], value: unknown): T {
  validate(schema, value)
  return value as T
}

function fakeClient(revision = batch.revision) {
  let workspace: ManualWorkspaceDto = {
    batch_id: batchId,
    revision,
    supported: true,
    capability: 'owned-fake-stock/1',
    lots: [
      { lot_id: a, reviewed: false, issues: [] },
      { lot_id: b, reviewed: false, issues: [] },
    ],
    runs: [],
    preparations: [],
    preparations_truncated: false,
    cursor: batch.cursor,
  }
  const accepted = { run_id: runId, approval_id: approvalId, preparation_id: prep }
  const client: ManualClient = {
    workspace: vi.fn(async () =>
      checked<Awaited<ReturnType<ManualClient['workspace']>>>('ManualWorkspace', workspace),
    ),
    activity: vi.fn(async () => ({
      runs: [{ batch_id: batchId, run_id: runId, state: 'recovery_required' as const }],
      truncated: false,
    })),
    review: vi.fn(async (_id, input) => {
      workspace = {
        ...workspace,
        lots: workspace.lots.map((value) => ({
          ...value,
          reviewed: input.selected_lot_ids.includes(value.lot_id),
        })),
      }
      return { reviewed_subject_ids: [a, partId], cursor: batch.cursor }
    }),
    prepare: vi.fn(async () => {
      workspace = { ...workspace, preparations: [preview] }
      return checked<Awaited<ReturnType<ManualClient['prepare']>>>('ManualPreparationResult', {
        status: 'prepared',
        preparation: preview,
      })
    }),
    approve: vi.fn(async () => {
      workspace = {
        ...workspace,
        preparations: [],
        runs: [run],
        lots: workspace.lots.map((value) =>
          value.lot_id === a
            ? {
                ...value,
                issues: [
                  {
                    code: 'original_contribution_already_approved',
                    message: 'Original approval retained',
                    lot_id: a,
                    run_id: runId,
                  },
                ],
              }
            : value,
        ),
      }
      return accepted
    }),
    run: vi.fn(async () => run),
    start: vi.fn(async () => accepted),
    cancel: vi.fn(async () => accepted),
    recover: vi.fn(async () => accepted),
  }
  return client
}

afterEach(() => {
  location.hash = ''
  vi.restoreAllMocks()
  onlineManager.setOnline(true)
  focusManager.setFocused(true)
})

test('manual review and approval keep exact A-only scope, scalar text and server digest while leaving B outside', async () => {
  const client = fakeClient()
  const navigate = vi.fn()
  const user = userEvent.setup()
  const props = {
    batch,
    client,
    edit: vi.fn(async () => undefined),
    navigate,
    reload: vi.fn(async () => undefined),
  }
  const view = render(<ManualWorkspace {...props} stage="review" />)
  await screen.findByRole('checkbox', { name: 'Select Packet A' })
  await user.click(screen.getByRole('checkbox', { name: 'Select Packet A' }))
  await user.click(screen.getByRole('button', { name: 'Inspect Packet A' }))
  expect(screen.getByText('Human count; do not merge packets.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Mark selected reviewed' }))
  expect(client.review).toHaveBeenCalledWith(
    batchId,
    { expected_batch_revision: '9007199254740993', selected_lot_ids: [a] },
    expect.any(String),
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Prepare exact selected effects' })).toBeEnabled(),
  )
  await user.click(screen.getByRole('button', { name: 'Prepare exact selected effects' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('approve', prep))
  view.rerender(<ManualWorkspace {...props} stage="approve" preparationId={prep} />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Approve 1 lot for the owned fake' })).toBeEnabled(),
  )
  expect(screen.getByText('Not included')).toBeVisible()
  expect(screen.getByText('Packet B')).toBeVisible()
  expect(screen.getByText('0.000001 × Packet A')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Approve 1 lot for the owned fake' }))
  expect(client.approve).toHaveBeenCalledWith(
    {
      preparation_id: prep,
      expected_plan_sha256: 'a'.repeat(64),
      expected_review_fingerprint: 'b'.repeat(64),
      selected_lot_ids: [a],
      expected_target_revision: '3',
    },
    expect.any(String),
  )
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('results', runId))
})

test('changed capture never silently reviews unseen values; explicit reload is required', async () => {
  const client = fakeClient('9007199254740994')
  const reload = vi.fn(async () => undefined)
  const user = userEvent.setup()
  render(
    <ManualWorkspace
      batch={batch}
      client={client}
      stage="review"
      edit={vi.fn(async () => undefined)}
      navigate={vi.fn()}
      reload={reload}
    />,
  )
  await screen.findByRole('checkbox', { name: 'Select Packet A' })
  await user.click(screen.getByRole('checkbox', { name: 'Select Packet A' }))
  expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeDisabled()
  expect(screen.getByText(/Your review display has not silently changed/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Load current saved choices' }))
  expect(reload).toHaveBeenCalledOnce()
  expect(client.review).not.toHaveBeenCalled()
})

test('unknown results retain uncertainty without create retry and app-wide activity links to original run', async () => {
  const unknown: ManualRunDto = {
    ...run,
    state: 'recovery_required',
    effect_certainty: 'unknown',
    dispatch_state: 'finished',
    operations: [{ ...run.operations[0], certainty: 'unknown', remote_pk: '7101' }],
    attributed_stock_ids: ['7101'],
  }
  const command = vi.fn()
  render(
    <>
      <ActivityIndicator client={fakeClient()} />
      <ResultsWorkspace batchId={batchId} runs={[unknown]} busy={false} command={command} />
    </>,
  )
  expect(
    screen.getByText(/Stock may have been created, or the original physical owner/),
  ).toBeVisible()
  expect(screen.getByText(/Attributed record #7101/)).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /resume|retry|queue supervised/i }),
  ).not.toBeInTheDocument()
  await screen.findByRole('link', { name: 'Open original run' })
  expect(screen.getByRole('link', { name: 'Open original run' })).toHaveAttribute(
    'href',
    `#${batchId}/results/${runId}`,
  )
  expect(command).not.toHaveBeenCalled()
})

test('Approve pins the requested preparation through poll ordering/removal and requires explicit replacement choice', async () => {
  const client = fakeClient()
  const laterId = 'a0000000-0000-4000-8000-000000000002'
  const later: ManualPreviewDto = {
    ...preview,
    id: laterId,
    selected_lot_ids: [b],
    remaining_lot_ids: [a],
    effects: [
      {
        ...preview.effects[0],
        lot_id: b,
        lot_label: 'Packet B',
        quantity: '23',
        location_id: null,
        location_label: 'No location',
        contribution_key: batch.lots[1].contribution_key,
        barcode: `bi1:${source}:${batch.lots[1].contribution_key}`,
      },
    ],
  }
  let preparations = [preview]
  vi.mocked(client.workspace).mockImplementation(async () =>
    checked<Awaited<ReturnType<ManualClient['workspace']>>>('ManualWorkspace', {
      batch_id: batchId,
      revision: batch.revision,
      supported: true,
      capability: 'owned-fake-stock/1',
      lots: [
        { lot_id: a, reviewed: true, issues: [] },
        { lot_id: b, reviewed: true, issues: [] },
      ],
      runs: [],
      preparations,
      preparations_truncated: false,
      cursor: batch.cursor,
    }),
  )
  const navigate = vi.fn()
  const props = {
    batch,
    client,
    edit: vi.fn(async () => undefined),
    navigate,
    reload: vi.fn(async () => undefined),
  }
  const user = userEvent.setup()
  const view = render(<ManualWorkspace {...props} stage="approve" preparationId={prep} />)
  await screen.findByText('0.000001 × Packet A')
  preparations = [later, preview]
  await waitFor(
    () => expect(screen.getByRole('option', { name: 'Packet B' })).toBeInTheDocument(),
    { timeout: 4000 },
  )
  expect(screen.getByText('0.000001 × Packet A')).toBeVisible()
  expect(screen.queryByText('23 × Packet B')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve 1 lot for the owned fake' })).toBeEnabled()
  expect(navigate).not.toHaveBeenCalled()
  preparations = [later]
  await waitFor(
    () => expect(screen.getByText(/The pinned preparation is unavailable/)).toBeVisible(),
    { timeout: 4000 },
  )
  expect(screen.getByText('0.000001 × Packet A')).toBeVisible()
  expect(screen.queryByText('23 × Packet B')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve 1 lot for the owned fake' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('Prepared selection'), laterId)
  expect(navigate).toHaveBeenCalledWith('approve', laterId)
  view.rerender(<ManualWorkspace {...props} stage="approve" preparationId={laterId} />)
  expect(await screen.findByText('23 × Packet B')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Approve 1 lot for the owned fake' }))
  expect(client.approve).toHaveBeenCalledWith(
    expect.objectContaining({ preparation_id: laterId, selected_lot_ids: [b] }),
    expect.any(String),
  )
  view.unmount()
  render(<ManualWorkspace {...props} stage="approve" preparationId={prep} />)
  await screen.findByText(/The pinned preparation is unavailable/)
  expect(screen.queryByText('23 × Packet B')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve 0 lots for the owned fake' })).toBeDisabled()
})

test('two activity observers share the same in-flight scoped read', async () => {
  const client = fakeClient()
  let finish: (() => void) | undefined
  const wait = new Promise<void>((resolve) => {
    finish = resolve
  })
  vi.mocked(client.activity).mockImplementation(async () => {
    await wait
    return { runs: [], truncated: false }
  })
  const view = render(
    <>
      <ActivityIndicator client={client} />
      <ActivityIndicator client={client} />
    </>,
  )
  await waitFor(() => expect(client.activity).toHaveBeenCalledTimes(1))
  const complete = finish
  if (!complete) {
    throw new Error('activity_fixture_not_started')
  }
  await act(async () => {
    complete()
  })
  await waitFor(() =>
    expect(
      screen
        .getAllByLabelText('Application activity')
        .every((element) => element.textContent?.includes('0 running')),
    ).toBe(true),
  )
  view.unmount()
})

test(
  'poll failure retains the selected review and disables commands until a later verified read',
  { timeout: 10000 },
  async () => {
    const client = fakeClient()
    const retained = await client.workspace(batchId)
    let available = true
    vi.mocked(client.workspace).mockImplementation(async () => {
      if (!available) {
        throw new Error('owned_read_unavailable')
      }
      return retained
    })
    vi.mocked(client.workspace).mockClear()
    const user = userEvent.setup()
    render(
      <ManualWorkspace
        batch={batch}
        client={client}
        stage="review"
        edit={vi.fn(async () => undefined)}
        navigate={vi.fn()}
        reload={vi.fn(async () => undefined)}
      />,
    )
    await screen.findByRole('checkbox', { name: 'Select Packet A' })
    await user.click(screen.getByRole('checkbox', { name: 'Select Packet A' }))
    expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeEnabled()
    available = false
    await screen.findByText(/Showing the last retained snapshot/, {}, { timeout: 4000 })
    expect(screen.getByRole('checkbox', { name: 'Select Packet A' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeDisabled()
    expect(client.workspace).toHaveBeenCalledTimes(2)

    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
    })
    expect(client.workspace).toHaveBeenCalledTimes(2)
    expect(client.review).not.toHaveBeenCalled()
    available = true
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeEnabled(),
      { timeout: 4000 },
    )
    expect(screen.getByRole('checkbox', { name: 'Select Packet A' })).toBeChecked()
    expect(client.review).not.toHaveBeenCalled()
  },
)

test('a paused offline read retains cached review but cannot authorize a command', async () => {
  const client = fakeClient()
  const cache = createServerQueryClient()
  cache.setDefaultOptions({
    queries: { ...cache.getDefaultOptions().queries, networkMode: 'online' },
  })
  const user = userEvent.setup()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerStateProvider scope={fixtureScope} client={cache}>
        {children}
      </ServerStateProvider>
    )
  }

  render(
    <ManualWorkspace
      batch={batch}
      client={client}
      stage="review"
      edit={vi.fn(async () => undefined)}
      navigate={vi.fn()}
      reload={vi.fn(async () => undefined)}
    />,
    { wrapper: Wrapper },
  )
  await screen.findByRole('checkbox', { name: 'Select Packet A' })
  await user.click(screen.getByRole('checkbox', { name: 'Select Packet A' }))
  await act(async () => {
    onlineManager.setOnline(false)
    void cache.invalidateQueries({ queryKey: serverQueryKey(fixtureScope, 'manual', batchId) })
  })
  await screen.findByText(/Showing the last retained snapshot/)
  expect(screen.getByRole('checkbox', { name: 'Select Packet A' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeDisabled()
  expect(client.workspace).toHaveBeenCalledTimes(1)
  expect(client.review).not.toHaveBeenCalled()
  await act(async () => {
    onlineManager.setOnline(true)
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeEnabled(),
  )
  expect(client.workspace).toHaveBeenCalledTimes(2)
  expect(client.review).not.toHaveBeenCalled()
})

test('a failed status refresh does not relabel a confirmed review command as uncertain', async () => {
  const client = fakeClient()
  const snapshot = await client.workspace(batchId)
  let statusAvailable = true
  vi.mocked(client.workspace).mockImplementation(async () => {
    if (!statusAvailable) {
      throw new Error('owned_status_read_unavailable')
    }
    return snapshot
  })
  vi.mocked(client.review).mockImplementation(async () => {
    statusAvailable = false
    return { reviewed_subject_ids: [a, partId], cursor: batch.cursor }
  })
  const user = userEvent.setup()
  render(
    <ManualWorkspace
      batch={batch}
      client={client}
      stage="review"
      edit={vi.fn(async () => undefined)}
      navigate={vi.fn()}
      reload={vi.fn(async () => undefined)}
    />,
  )
  await screen.findByRole('checkbox', { name: 'Select Packet A' })
  await user.click(screen.getByRole('checkbox', { name: 'Select Packet A' }))
  await user.click(screen.getByRole('button', { name: 'Mark selected reviewed' }))
  await screen.findByText(/Showing the last retained snapshot/)
  expect(client.review).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeDisabled()
  expect(screen.queryByText(/command outcome is not confirmed/i)).not.toBeInTheDocument()
})

test('a cached preparation remains visible but cannot be approved before the mounted read is verified', async () => {
  const client = fakeClient()
  const cache = createServerQueryClient()
  const snapshot: ManualWorkspaceDto = {
    ...(await client.workspace(batchId)),
    preparations: [preview],
  }
  cache.setQueryData(serverQueryKey(fixtureScope, 'manual', batchId), snapshot)
  let finish: ((value: ManualWorkspaceDto) => void) | undefined
  const mountedRead = new Promise<ManualWorkspaceDto>((resolve) => {
    finish = resolve
  })
  vi.mocked(client.workspace).mockReturnValue(mountedRead)

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerStateProvider scope={fixtureScope} client={cache}>
        {children}
      </ServerStateProvider>
    )
  }

  render(
    <ManualWorkspace
      batch={batch}
      client={client}
      stage="approve"
      preparationId={prep}
      edit={vi.fn(async () => undefined)}
      navigate={vi.fn()}
      reload={vi.fn(async () => undefined)}
    />,
    { wrapper: Wrapper },
  )
  await screen.findByText('0.000001 × Packet A')
  expect(screen.getByText(/Verifying current retained state/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Approve 1 lot for the owned fake' })).toBeDisabled()
  expect(client.approve).not.toHaveBeenCalled()
  const complete = finish
  if (!complete) {
    throw new Error('mounted_read_fixture_not_started')
  }
  await act(async () => {
    complete(snapshot)
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Approve 1 lot for the owned fake' })).toBeEnabled(),
  )
  expect(client.approve).not.toHaveBeenCalled()
})

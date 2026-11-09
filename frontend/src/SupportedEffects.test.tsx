import { expect, test, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from './test/render'
import { CaptureEditor } from './components/capture/CaptureEditor'
import { DecisionPanel } from './components/operator/DecisionPanel'
import { EffectOutcome as SupportedEffectResult } from './components/changes/EffectOutcome'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { BatchCommandsProvider } from './components/batches/BatchCommandsProvider'
import { batchCommands } from './test/batch-commands'

const batchId = '10000000-0000-4000-8000-000000000001'
const partId = '20000000-0000-4000-8000-000000000002'
const context = '30000000-0000-4000-8000-000000000003'
const categoryId = '40000000-0000-4000-8000-000000000004'
const batch: CaptureSnapshotDto = {
  id: batchId,
  source_id: batchId,
  title: 'Shared Part capture',
  revision: '7',
  archived: false,
  updated_at: 'fixture',
  actor_id: batchId,
  target_context_id: context,
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
  parts: [{ id: partId, label: 'Shared resistor', revision: '1', choice: { mode: 'unset' } }],
  lots: [],
  notes: [],
  observations: [
    {
      id: categoryId,
      model: 'category',
      pk: '81',
      target_context_id: context,
      label: 'Resistors',
      observed_at: 'fixture',
      mapping: { kind: 'category' },
    },
  ],
  cursor: { stream_id: batchId, sequence: '0' },
}

test('human explicitly chooses one shared new Part with an observed category and exact saved spec', async () => {
  const user = userEvent.setup()
  const edit = vi.fn().mockResolvedValue(undefined)
  const onDirty = vi.fn()
  render(
    <BatchCommandsProvider value={batchCommands({ observe: vi.fn() })}>
      <CaptureEditor
        batch={batch}
        selected={partId}
        frozen={false}
        dirty={true}
        onDirty={onDirty}
        edit={edit}
      />
    </BatchCommandsProvider>,
  )
  await user.selectOptions(screen.getByLabelText('Part action'), 'create')
  await user.type(screen.getByLabelText('New Part name'), 'Resistor Ω')
  await user.selectOptions(screen.getByLabelText('Existing category'), categoryId)
  await user.click(screen.getByRole('button', { name: 'Save human changes' }))
  await waitFor(() => expect(edit).toHaveBeenCalledOnce())
  expect(edit).toHaveBeenCalledWith({
    kind: 'part',
    id: partId,
    label: 'Shared resistor',
    choice: {
      mode: 'create',
      spec: {
        name: 'Resistor Ω',
        category: {
          observation_id: categoryId,
          target_context_id: context,
          model: 'category',
          pk: '81',
        },
        parameters: [],
        manufacturer: null,
        supplier: null,
        tags: [],
      },
    },
  })
  expect(onDirty).toHaveBeenCalledWith(true)
})

test('unknown supported effect offers read-only known-output assessment and retains all attributed IDs', async () => {
  const user = userEvent.setup()
  const recover = vi.fn()
  render(
    <SupportedEffectResult
      effect={{
        operation_key: partId,
        part_subject_id: partId,
        kind: 'create_part',
        label: 'Shared Part',
        dependencies: [],
        inputs: { name: 'Resistor Ω', category: '81' },
        certainty: 'unknown',
        remote_pks: ['9007199254740993'],
        verification: null,
        recovery_action: 'verify_effect',
      }}
      busy={false}
      recover={recover}
    />,
  )
  expect(screen.getByText(/9007199254740993/)).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Inspect known original effect: Shared Part' }),
  )
  expect(recover).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: /Resume selected/ })).toBeNull()
})

test('Review presents an explicit new shared Part without asking for an existing match', () => {
  const part: CaptureSnapshotDto['parts'][number] = {
    ...batch.parts[0],
    choice: {
      mode: 'create',
      spec: {
        name: 'Resistor Ω',
        category: {
          observation_id: categoryId,
          target_context_id: context,
          model: 'category',
          pk: '81',
        },
        parameters: [],
        manufacturer: null,
        supplier: null,
        tags: [],
      },
    },
  }
  const lot: CaptureSnapshotDto['lots'][number] = {
    id: '50000000-0000-4000-8000-000000000005',
    label: 'Packet A',
    revision: '1',
    contribution_key: '60000000-0000-4000-8000-000000000006',
    part_subject_id: partId,
    quantity: { mode: 'set', value: '17' },
    location: { mode: 'inherit' },
  }
  render(
    <BatchCommandsProvider value={batchCommands({ edit: vi.fn(), reload: vi.fn() })}>
      <DecisionPanel
        batch={{ ...batch, parts: [part], lots: [lot] }}
        lot={lot}
        part={part}
        workspace={{
          batch_id: batchId,
          revision: batch.revision,
          supported: true,
          capability: 'owned-fake-stock/1',
          lots: [{ lot_id: lot.id, reviewed: false, issues: [] }],
          runs: [],
          preparations: [],
          preparations_truncated: false,
          cursor: batch.cursor,
        }}
        activeLotIds={[lot.id]}
        disabled={false}
        inspect={vi.fn()}
      />
    </BatchCommandsProvider>,
  )
  expect(screen.getByText('New shared Part')).toBeVisible()
  expect(screen.getByText('Create shared Part: Resistor Ω')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Compare matches' })).not.toBeInTheDocument()
})

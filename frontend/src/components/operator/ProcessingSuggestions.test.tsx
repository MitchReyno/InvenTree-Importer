import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, ProcessingProposalDto } from '@invimport/contracts'
import { render } from '../../test/render'
import { ProcessingSuggestions, mergeTags } from './ProcessingSuggestions'

const lot = {
  id: '30000000-0000-4000-8000-000000000003',
  label: 'Opened reel',
  revision: '1',
  contribution_key: '40000000-0000-4000-8000-000000000004',
  part_subject_id: '20000000-0000-4000-8000-000000000002',
  quantity: { mode: 'inherit' as const },
  location: { mode: 'inherit' as const },
} as CaptureSnapshotDto['lots'][number]
const spec = { name: 'Reel', tags: ['SMD'] } as never
const creating = {
  id: lot.part_subject_id!,
  label: 'Shared reel',
  revision: '1',
  choice: { mode: 'create' as const, spec },
} as CaptureSnapshotDto['parts'][number]
const existing = {
  ...creating,
  choice: { mode: 'set', value: {} },
} as unknown as CaptureSnapshotDto['parts'][number]
const proposal = {
  schema_version: 'bench-intake-proposal/4',
  subject_id: lot.id,
  summary: 'Estimate',
  sources: [],
  quantity: { value: '40', status: 'estimated' },
  tags: ['smd', '0603'],
} as unknown as ProcessingProposalDto

test('an estimate is accepted only by an explicit human edit when no count exists', async () => {
  const edit = vi.fn(async () => true)
  render(
    <ProcessingSuggestions
      lot={lot}
      part={creating}
      proposal={proposal}
      defaultQuantity={{ mode: 'unset' }}
      current
      disabled={false}
      edit={edit}
    />,
  )
  expect(
    screen.getByText(/Estimated quantity 40 · from the evidence above · not yet chosen/),
  ).toBeVisible()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Use estimated quantity 40 for Opened reel' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'lot',
    id: lot.id,
    quantity: { mode: 'set', value: '40' },
  })
})

test('a human count is kept and the estimate stays history', () => {
  render(
    <ProcessingSuggestions
      lot={{ ...lot, quantity: { mode: 'set', value: '37' } }}
      part={creating}
      proposal={proposal}
      defaultQuantity={{ mode: 'unset' }}
      current
      disabled={false}
      edit={vi.fn()}
    />,
  )
  expect(screen.getByText(/the human count is kept/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /Use estimated quantity/ })).not.toBeInTheDocument()
})

test('an inherited exact batch count is a human count too', () => {
  render(
    <ProcessingSuggestions
      lot={lot}
      part={creating}
      proposal={proposal}
      defaultQuantity={{ mode: 'set', value: '37' }}
      current
      disabled={false}
      edit={vi.fn()}
    />,
  )
  expect(screen.getByText(/the human count is kept/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /Use estimated quantity/ })).not.toBeInTheDocument()
})

test('suggested tags merge case-insensitively into a new Part and never touch an existing Part', async () => {
  const edit = vi.fn(async () => true)
  const view = render(
    <ProcessingSuggestions
      lot={lot}
      part={creating}
      proposal={proposal}
      defaultQuantity={{ mode: 'unset' }}
      current
      disabled={false}
      edit={edit}
    />,
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Add suggested tags to Shared reel' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'part',
    id: creating.id,
    choice: { mode: 'create', spec: { name: 'Reel', tags: ['SMD', '0603'] } },
  })
  view.rerender(
    <ProcessingSuggestions
      lot={lot}
      part={existing}
      proposal={proposal}
      defaultQuantity={{ mode: 'unset' }}
      current
      disabled={false}
      edit={edit}
    />,
  )
  expect(screen.queryByRole('button', { name: /Add suggested tags/ })).not.toBeInTheDocument()
  expect(screen.getByText(/existing inventory Part.s tags are not changed/)).toBeVisible()
})

test('a superseded attempt is history only and offers no acceptance', () => {
  render(
    <ProcessingSuggestions
      lot={lot}
      part={creating}
      proposal={proposal}
      defaultQuantity={{ mode: 'unset' }}
      current={false}
      disabled={false}
      edit={vi.fn()}
    />,
  )
  expect(screen.getByText(/superseded by newer input, history only/)).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('accented tags stay distinct while ASCII aliases merge, matching the inventory policy', () => {
  expect(mergeTags(['É', 'SMD'], ['é', 'smd', 'Reel'])).toEqual(['É', 'SMD', 'é', 'Reel'])
})

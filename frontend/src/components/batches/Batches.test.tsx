import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import type { Client } from '../../capture/client'
import { Batches } from './Batches'

const saved = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  title: 'Bench bag',
  revision: '9007199254740993',
  updated_at: '2026-11-02T12:00:00Z',
  archived: false,
}

test('offers explicit stage links without fetching every batch, and searches only loaded titles', async () => {
  const user = userEvent.setup()
  const client: Client = {
    list: vi.fn(async () => ({
      batches: [saved, { ...saved, id: 'archived', title: 'Old receipt', archived: true }],
      truncated: true,
    })),
    read: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    observe: vi.fn(),
  }
  render(<Batches client={client} onDirtyChange={vi.fn()} />)
  const continueCard = await screen.findByRole('region', { name: 'Bench bag' })
  expect(within(continueCard).getByRole('link', { name: 'Capture' })).toHaveAttribute(
    'href',
    `#${saved.id}/capture`,
  )
  expect(within(continueCard).getByRole('link', { name: 'Processing' })).toHaveAttribute(
    'href',
    `#${saved.id}/processing/overview`,
  )
  expect(within(continueCard).getByRole('link', { name: 'Review' })).toHaveAttribute(
    'href',
    `#${saved.id}/review`,
  )
  expect(within(continueCard).getByRole('link', { name: 'Results' })).toHaveAttribute(
    'href',
    `#${saved.id}/results`,
  )
  expect(screen.getAllByRole('link')).toHaveLength(4)
  const search = screen.getByRole('searchbox', { name: 'Search loaded batches' })
  await user.type(search, 'BENCH')
  expect(screen.queryByRole('region', { name: 'Bench bag' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Bench bag' })).toHaveAttribute(
    'href',
    `#${saved.id}/capture`,
  )
  await user.clear(search)
  expect(screen.getByRole('region', { name: 'Bench bag' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Bench bag' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('searchbox', { name: 'Search loaded batches' }), 'RECEIPT')
  expect(screen.queryByRole('link', { name: 'Old receipt' })).not.toBeInTheDocument()
  expect(screen.getByText(/No loaded batches match/)).toBeVisible()
  await user.click(screen.getByLabelText('Show archived'))
  expect(screen.getByRole('link', { name: 'Old receipt' })).toBeVisible()
  expect(screen.getByText(/Older batches remain retained/)).toBeVisible()
  expect(client.list).toHaveBeenCalledTimes(1)
  expect(client.read).not.toHaveBeenCalled()
})

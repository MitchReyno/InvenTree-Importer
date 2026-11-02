import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import type { CaptureListQueryDto } from '@invimport/contracts'
import { Batches } from './Batches'

const saved = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  title: 'Bench bag',
  revision: '9007199254740993',
  updated_at: '2026-11-02T12:00:00Z',
  archived: false,
  workflow: {
    lots: 2,
    ready: 1,
    needs_review: 1,
    blocked: 0,
    approved: 0,
    open_questions: 3,
    active_jobs: 1,
    latest_round: null,
    thumbnail: { preview_id: '30000000-0000-4000-8000-000000000003', label: 'Packet original' },
  },
}

const client = () => ({
  list: vi.fn(async (query?: CaptureListQueryDto) => ({
    batches: query?.q ? [{ ...saved, title: 'Older receipt' }] : [saved],
    truncated: !query?.q,
  })),
  read: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  observe: vi.fn(),
})

test('shows retained thumbnail/counts and submits server search once rather than on every key', async () => {
  const user = userEvent.setup()
  const api = client()
  render(<Batches client={api} onDirtyChange={vi.fn()} />)
  const continued = await screen.findByRole('region', { name: 'Bench bag' })
  expect(within(continued).getByRole('img', { name: 'Packet original' })).toHaveAttribute(
    'src',
    `/api/v1/batches/${saved.id}/media/previews/${saved.workflow.thumbnail.preview_id}`,
  )
  expect(within(continued).getByRole('link', { name: '1 ready for approval' })).toHaveAttribute(
    'href',
    `#${saved.id}/review?filter=reviewed`,
  )
  expect(within(continued).getByRole('link', { name: 'Processing' })).toHaveAttribute(
    'href',
    `#${saved.id}/processing/overview`,
  )
  const search = screen.getByRole('searchbox', { name: 'Search retained batches' })
  await user.type(search, 'older receipt')
  expect(api.list).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: /^Search$/ }))
  expect(await screen.findByRole('link', { name: 'Older receipt' })).toBeVisible()
  expect(api.list).toHaveBeenLastCalledWith({
    q: 'older receipt',
    archived: 'exclude',
    offset: '0',
  })
  expect(screen.queryByRole('region', { name: 'Bench bag' })).not.toBeInTheDocument()
  expect(api.read).not.toHaveBeenCalled()
  await user.click(screen.getByLabelText('Show archived'))
  await screen.findByRole('link', { name: 'Older receipt' })
  expect(api.list).toHaveBeenLastCalledWith({
    q: 'older receipt',
    archived: 'include',
    offset: '0',
  })
  await user.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(await screen.findByRole('region', { name: 'Bench bag' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Next batches' }))
  await screen.findByText('Page 2')
  expect(api.list).toHaveBeenLastCalledWith({ q: '', archived: 'include', offset: '10' })
})

test('failed search reports unavailable rather than claiming no matching retained batches', async () => {
  const user = userEvent.setup()
  const api = client()
  render(<Batches client={api} onDirtyChange={vi.fn()} />)
  await screen.findByRole('region', { name: 'Bench bag' })
  api.list.mockRejectedValueOnce(new Error('offline'))
  await user.type(screen.getByRole('searchbox'), 'somewhere')
  await user.click(screen.getByRole('button', { name: /^Search$/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load retained batches')
  expect(screen.queryByText('No retained batches match this title.')).not.toBeInTheDocument()
})

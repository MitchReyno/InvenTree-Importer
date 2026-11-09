import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import type { CaptureListQueryDto, InboxWorkflowDto } from '@invimport/contracts'
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
    latest_round: null as InboxWorkflowDto['latest_round'],
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

test('rows and the Continue card say what stage the batch is at, its evidence and possible duplicates', async () => {
  const idle = { jobs: 0, ready: 0, running: 0 }
  const api = client()
  const sorting = {
    ...saved,
    workflow: {
      ...saved.workflow,
      lots: 5,
      steps: {
        examine: { jobs: 1, ready: 0, running: 1 },
        research: idle,
        images: idle,
        inventory: idle,
      },
      evidence: { photos: 4, documents: 1, other: 0 },
      possible_duplicates: 1,
    },
  }
  api.list.mockResolvedValue({
    batches: [sorting, { ...sorting, id: saved.source_id }],
    truncated: false,
  })
  render(<Batches client={api} onDirtyChange={vi.fn()} />)

  const continued = await screen.findByRole('region', { name: 'Bench bag' })
  expect(within(continued).getByLabelText('Batch counts')).toHaveTextContent('1 possible duplicate')
  expect(continued).toHaveTextContent('Sorting into lots · 5 found so far')
  const row = screen.getAllByRole('link', { name: 'Bench bag' }).at(-1)!
  expect(row).toHaveAccessibleDescription(/Sorting into lots · 5 found so far/)
  expect(row).toHaveTextContent('4 photos · 1 document')
  // A batch shown only as a row warns of possible duplicates too.
  expect(row).toHaveAccessibleDescription(/1 possible duplicate/)
})

test('shows retained thumbnail/counts and submits server search once rather than on every key', async () => {
  const user = userEvent.setup()
  const api = client()
  render(<Batches client={api} onDirtyChange={vi.fn()} />)
  const continued = await screen.findByRole('region', { name: 'Bench bag' })
  expect(within(continued).getByRole('img', { name: 'Packet original' })).toHaveAttribute(
    'src',
    `/api/v1/batches/${saved.id}/media/previews/${saved.workflow.thumbnail.preview_id}?size=thumb`,
  )
  expect(within(continued).getByText('3 need you')).toBeVisible()
  expect(within(continued).getByText('Processing')).toBeVisible()
  expect(within(continued).getByLabelText('Batch counts')).toHaveTextContent(
    '2 lots proposed1 ready3 questions',
  )
  // Ready counts what Ready to add lists: reviewed, nothing blocking and not yet approved.
  expect(within(continued).getByRole('link', { name: 'Add 1 ready lot' })).toHaveAttribute(
    'href',
    `#${saved.id}/changes/ready`,
  )
  // One primary and one secondary action; the stage links are gone.
  expect(within(continued).queryByRole('link', { name: 'Processing' })).not.toBeInTheDocument()
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

test('each batch row is one link named by its title and described by its state', async () => {
  const user = userEvent.setup()
  const api = client()
  api.list.mockImplementation(async () => ({
    batches: [
      saved,
      {
        ...saved,
        id: '10000000-0000-4000-8000-000000000009',
        title: 'Rockby order',
        workflow: {
          ...saved.workflow,
          lots: 6,
          approved: 6,
          open_questions: 0,
          active_jobs: 0,
          latest_round: {
            run_id: '40000000-0000-4000-8000-000000000004',
            round_number: '1',
            state: 'settled_complete',
            confirmed_stock: 6,
          },
        },
      },
    ],
    truncated: false,
  }))
  render(<Batches client={api} onDirtyChange={vi.fn()} />)
  await screen.findByRole('region', { name: 'Bench bag' })

  const row = screen.getByRole('link', { name: 'Rockby order' })
  expect(row).toHaveAttribute('href', '#10000000-0000-4000-8000-000000000009/capture')
  expect(row).toHaveAccessibleDescription(/Complete/)
  expect(within(row).queryByText('Notes / known values')).not.toBeInTheDocument()
  expect(screen.getByText(/All batches · 1/)).toBeVisible()
  void user
})

test('times read relatively, keep the exact time, and the list has no footnote', async () => {
  const api = client()
  const older = { ...saved, id: '10000000-0000-4000-8000-000000000009', title: 'Rockby order' }
  api.list.mockImplementation(async () => ({ batches: [saved, older], truncated: false }))
  render(<Batches client={api} onDirtyChange={vi.fn()} />)
  const card = await screen.findByRole('region', { name: 'Bench bag' })

  expect(within(card).getByText(/Last activity/)).toContainElement(
    card.querySelector(`time[datetime="${saved.updated_at}"]`) as HTMLElement,
  )
  const row = screen.getByRole('link', { name: 'Rockby order' })
  expect(row.querySelector('time')).toHaveAttribute('datetime', older.updated_at)
  expect(row.querySelector('time')?.textContent).toMatch(/ago$|^just now$/)
  expect(screen.queryByText(/Search covers every retained batch title/)).not.toBeInTheDocument()
})

test('the Continue card counts the lots its Review filter opens', async () => {
  const api = client()
  api.list.mockImplementation(async () => ({
    batches: [
      {
        ...saved,
        workflow: {
          ...saved.workflow,
          lots: 10,
          needs_review: 3,
          open_questions: 0,
          active_jobs: 0,
        },
      },
    ],
    truncated: false,
  }))
  render(<Batches client={api} onDirtyChange={vi.fn()} />)
  const continued = await screen.findByRole('region', { name: 'Bench bag' })

  expect(within(continued).getByRole('link', { name: 'Review 3 lots' })).toHaveAttribute(
    'href',
    `#${saved.id}/review/lots?filter=needs_review`,
  )
})

test('the page heading carries no helper sentence', async () => {
  render(<Batches client={client()} onDirtyChange={vi.fn()} />)

  expect(await screen.findByRole('heading', { name: 'Batches', level: 1 })).toBeVisible()
  expect(screen.queryByText(/Photograph what's on the bench/)).not.toBeInTheDocument()
})

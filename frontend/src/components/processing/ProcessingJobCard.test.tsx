import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { CaptureSnapshotDto, ProcessingJobDto } from '@invimport/contracts'
import { ProcessingJobCard } from './ProcessingJobCard'

const batch = { lots: [{ id: 'l1', label: 'Reels' }], parts: [] } as unknown as CaptureSnapshotDto

const job = (subject: string | null) =>
  ({
    id: 'j',
    subject_id: subject,
    stage: subject ? 'research' : 'examine',
    state: 'running',
    attempt_number: 1,
    qualification: 'fixture_only',
    questions: [],
    proposals: [],
  }) as unknown as ProcessingJobDto

it('names the batch for the Examine lead session and the lot otherwise', () => {
  const props = { batch, disabled: false, cancel: vi.fn(), chooseQuestion: vi.fn() }
  const { unmount } = render(<ProcessingJobCard job={job(null)} {...props} />)
  expect(screen.getByRole('heading', { name: 'Whole batch · examine' })).toBeInTheDocument()
  unmount()
  render(<ProcessingJobCard job={job('l1')} {...props} />)
  expect(screen.getByRole('heading', { name: 'Reels · research' })).toBeInTheDocument()
})

it('labels stale and provisional candidates', () => {
  const props = { batch, disabled: false, cancel: vi.fn(), chooseQuestion: vi.fn() }

  const proposal = (id: string, summary: string, currentness: unknown) => ({
    id,
    message_id: id,
    value: { subject_id: 'l1', summary, sources: [] },
    currentness,
  })

  render(
    <ProcessingJobCard
      job={
        {
          ...job('l1'),
          proposals: [
            proposal('p1', 'Identity 74HC00.', { state: 'stale', reason: 'operator_correction' }),
            proposal('p2', 'Estimated 10.', { state: 'provisional' }),
            proposal('p3', 'Markings read.', { state: 'current' }),
          ],
        } as unknown as ProcessingJobDto
      }
      {...props}
    />,
  )
  expect(screen.getByText('Stale · you corrected what it relied on')).toBeVisible()
  expect(screen.getByText('Provisional · a question is open')).toBeVisible()
  expect(screen.getAllByText(/Stale|Provisional/)).toHaveLength(2)
})

it('shows a stepped question by its title, step count, reason and assumptions, and a /1 one as before', () => {
  const props = { batch, disabled: false, cancel: vi.fn(), chooseQuestion: vi.fn() }
  const open = { job_id: 'j', attempt_id: 'a', input_sha256: 'x', revision: '1', state: 'open' }
  render(
    <ProcessingJobCard
      job={
        {
          ...job('l1'),
          questions: [
            {
              ...open,
              id: 'q2',
              subject_id: 'l1',
              schema_version: 'bench-intake-question/2',
              fields: ['identity'],
              title: 'Same Part, and where it goes',
              reason: 'The date codes differ.',
              steps: [
                {
                  id: 'same',
                  prompt: 'Same Part?',
                  assumption: 'Same Part',
                  answer: {
                    kind: 'choice',
                    other: false,
                    options: [
                      { id: 'y', label: 'Yes' },
                      { id: 'n', label: 'No' },
                    ],
                  },
                },
                {
                  id: 'where',
                  prompt: 'Where?',
                  assumption: 'Drawer R3',
                  answer: { kind: 'text' },
                },
              ],
            },
            {
              ...open,
              id: 'q1',
              subject_id: 'l1',
              spec: { kind: 'quantity', prompt: 'How many reels?', reason: 'Folded label.' },
              assumption: 'One reel',
            },
          ],
        } as unknown as ProcessingJobDto
      }
      {...props}
    />,
  )
  expect(screen.getByText('Same Part, and where it goes')).toBeVisible()
  expect(screen.getByText('2 steps · The date codes differ.')).toBeVisible()
  expect(screen.getByText('Continuing on: Same Part · Drawer R3')).toBeVisible()
  expect(screen.getByText('How many reels?')).toBeVisible()
  expect(screen.getByText('Continuing on: One reel')).toBeVisible()
})

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

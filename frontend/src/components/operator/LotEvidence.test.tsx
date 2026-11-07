import { screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { render } from '../../test/render'
import { LotEvidence } from './LotEvidence'

const lot = {
  id: '30000000-0000-4000-8000-000000000003',
  label: 'Opened reel',
  revision: '1',
  contribution_key: '40000000-0000-4000-8000-000000000004',
  part_subject_id: null,
  quantity: { mode: 'inherit' as const },
  location: { mode: 'inherit' as const },
}
const batch = {
  id: '10000000-0000-4000-8000-000000000001',
  revision: '7',
  lots: [lot],
  parts: [],
  notes: [],
  observations: [],
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
} as unknown as CaptureSnapshotDto
const processing = {
  capture_revision: '6',
  jobs: [
    {
      id: '50000000-0000-4000-8000-000000000005',
      subject_id: lot.id,
      stage: 'reading',
      state: 'ready',
      attempt_number: '1',
      proposals: [
        {
          id: '60000000-0000-4000-8000-000000000006',
          message_id: '70000000-0000-4000-8000-000000000007',
          value: {
            schema_version: 'bench-intake-proposal/4',
            subject_id: lot.id,
            summary: 'Fixture estimate',
            sources: [],
            quantity: { value: '40', status: 'estimated' },
          },
        },
      ],
      questions: [],
    },
  ],
} as unknown as ProcessingSnapshotDto

test('a ready job from a cached or older Processing read is history, not acceptable', () => {
  const view = render(
    <LotEvidence
      batch={batch}
      lot={lot}
      part={undefined}
      processing={processing}
      processingCurrent={false}
      edit={vi.fn()}
      editDisabled={false}
    />,
  )
  expect(screen.queryByRole('button', { name: /Use estimated quantity/ })).not.toBeInTheDocument()
  expect(screen.getByText(/superseded by newer input, history only/)).toBeVisible()
  view.rerender(
    <LotEvidence
      batch={batch}
      lot={lot}
      part={undefined}
      processing={processing}
      processingCurrent
      edit={vi.fn()}
      editDisabled={false}
    />,
  )
  expect(screen.getByRole('button', { name: /Use estimated quantity 40/ })).toBeEnabled()
})

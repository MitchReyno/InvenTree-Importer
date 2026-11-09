import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { SharedTagsChoice } from './SharedTagsChoice'

const intent = (manual: string[], auto: boolean) =>
  ({
    id: '10000000-0000-4000-8000-000000000001',
    defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
    notes: [],
    observations: [],
    settings_intent: {
      value: {
        supplier: { absent: false, selection: { mode: 'unset' } },
        order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
        shared_tags: { manual, auto },
      },
      default_location_draft: null,
      version: '1',
      actor_id: '50000000-0000-4000-8000-000000000005',
      created_at: '2026-11-05T00:00:00Z',
    },
  }) as unknown as CaptureSnapshotDto

const part = (tags: string[]) =>
  ({
    id: '20000000-0000-4000-8000-000000000002',
    label: 'Shared reel',
    revision: '1',
    choice: { mode: 'create', spec: { name: 'Reel', tags } },
  }) as unknown as CaptureSnapshotDto['parts'][number]

test('batch manual tags become an explicit reviewed choice on a new Part', async () => {
  const edit = vi.fn(async () => true)
  render(
    <SharedTagsChoice
      batch={intent(['reel', 'SMD'], false)}
      part={part(['smd'])}
      disabled={false}
      edit={edit}
    />,
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Add batch tags reel to Shared reel' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'part',
    id: part([]).id,
    choice: { mode: 'create', spec: { name: 'Reel', tags: ['smd', 'reel'] } },
  })
})

test('Auto-only batches add nothing manual, and existing Parts are only explained', () => {
  const view = render(
    <SharedTagsChoice batch={intent([], true)} part={part([])} disabled={false} edit={vi.fn()} />,
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  view.rerender(
    <SharedTagsChoice
      batch={intent(['reel'], false)}
      part={{ ...part([]), choice: { mode: 'set', value: {} } } as never}
      disabled={false}
      edit={vi.fn()}
    />,
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByText(/existing inventory Part.s tags are not changed/)).toBeVisible()
})

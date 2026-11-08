import type { CaptureSnapshotDto } from '@invimport/contracts'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render } from '../../test/render'
import { DecisionPanel, recordLinks } from './DecisionPanel'

const batch = { id: 'b' } as unknown as CaptureSnapshotDto
const lot = { id: 'l', label: 'Packet A' } as unknown as CaptureSnapshotDto['lots'][number]

describe('recordLinks', () => {
  it('shows a location made at approval as new, not as existing', () => {
    const links = recordLinks(batch, lot, undefined, undefined, {
      value: 'New location Shelf 3 · created only after approval',
      provenance: 'inherited',
    })

    expect(links.find((link) => link.kind === 'Location')?.state).toBe('new')
  })

  it('shows a chosen location as existing and a missing one as to choose', () => {
    const chosen = recordLinks(batch, lot, undefined, undefined, {
      value: 'Shelf 3',
      provenance: 'human',
    })
    const missing = recordLinks(batch, lot, undefined, undefined, {
      value: 'Not selected',
      provenance: 'unset',
    })

    expect(chosen.find((link) => link.kind === 'Location')?.state).toBe('exists')
    expect(missing.find((link) => link.kind === 'Location')?.state).toBe('choose')
  })
})

describe('the inline answer', () => {
  const question = {
    id: 'c0000000-0000-4000-8000-0000000000b1',
    job_id: 'c0000000-0000-4000-8000-0000000000b2',
    attempt_id: 'c0000000-0000-4000-8000-0000000000b3',
    input_sha256: 'b'.repeat(64),
    revision: '1',
    state: 'open',
    spec: { kind: 'quantity', subject_id: 'l', prompt: 'How many?', reason: 'Torn label.' },
  }
  const open = { id: question.id, step: 'examine', question, captureRevision: '4' } as never
  const panelBatch = {
    id: 'b',
    revision: '4',
    archived: false,
    lots: [
      {
        id: 'l',
        label: 'Packet B',
        quantity: { mode: 'set', value: '17' },
        location: { mode: 'inherit' },
        part_subject_id: null,
      },
    ],
    parts: [],
    defaults: { quantity: { mode: 'unset' }, location: { mode: 'clear' } },
    observations: [],
    notes: [],
  } as unknown as CaptureSnapshotDto

  const panel = (openQuestion: never | null) => (
    <DecisionPanel
      batch={panelBatch}
      lot={panelBatch.lots[0]}
      part={undefined}
      workspace={{ lots: [], preparations: [], runs: [] } as never}
      activeLotIds={['l']}
      disabled={false}
      edit={async () => true}
      reload={async () => {}}
      inspect={() => {}}
      openQuestion={openQuestion}
      answerQuestion={async () => {}}
    />
  )

  it('keeps its draft when a later read no longer lists the question', async () => {
    const user = userEvent.setup()
    const view = render(panel(open))
    await user.click(screen.getByRole('button', { name: 'Answer here' }))
    await user.type(screen.getByLabelText('Quantity'), '9')
    view.rerender(panel(null))
    expect(screen.getByLabelText('Quantity')).toHaveValue('9')
    expect(screen.getByText(/superseded or its saved context changed/)).toBeVisible()
  })
})

import type { CaptureSnapshotDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { recordLinks } from './DecisionPanel'

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

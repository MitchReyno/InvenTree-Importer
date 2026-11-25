import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { BriefEntryDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { H, historyBrief } from '#/test/session-history'
import { BriefContent } from './BriefContent'

const SECOND_VERSION = '64000000-0000-4000-8000-000000000006'

function evidence(version: string, label: string): BriefEntryDto {
  return {
    kind: 'evidence',
    evidence_id: version === H.version ? H.evidence : H.evidence2,
    version_id: version,
    sha256: 'c'.repeat(64),
    media_type: 'image/jpeg',
    label,
    regions: [],
  }
}

function keepOut(observation: string, version: string, markings: string[]): BriefEntryDto {
  return {
    kind: 'keep_out',
    observation_id: observation,
    lot_id: null,
    evidence_version_id: version,
    page: 1,
    region: {
      kind: 'pixels',
      x: 40,
      y: 60,
      width: 120,
      height: 80,
      source_width: 4000,
      source_height: 3000,
    },
    markings,
  }
}

test('an Images brief names the source and region of each item to keep out of frame', () => {
  const item = historyBrief([
    evidence(H.version, 'Tray'),
    evidence(SECOND_VERSION, 'Reel label'),
    keepOut(H.observation, H.version, ['16 MHz']),
    keepOut(H.observation2, SECOND_VERSION, []),
  ])
  render(<BriefContent item={{ ...item, brief: { ...item.brief, stage: 'images' } }} />)

  const rows = within(screen.getByRole('list', { name: 'Keep out of frame' })).getAllByRole(
    'listitem',
  )
  expect(rows.map((row) => row.textContent)).toEqual([
    'Tray, page 1: 16 MHz120×80 px at 40, 60',
    'Reel label, page 1: an unmarked item120×80 px at 40, 60',
  ])
})

test('a lot edit shows the quantity the operator left', () => {
  const edit: BriefEntryDto = {
    kind: 'lot_edit',
    source: 'human',
    edit_id: `lot:${H.lot}:${'d'.repeat(64)}`,
    lot_id: H.lot,
    lot_revision: '4',
    label: 'ATmega328P',
    quantity: { mode: 'set', value: '480' },
    part_subject_id: null,
    excluded: null,
  }
  render(<BriefContent item={historyBrief([edit])} />)

  expect(screen.getByRole('list', { name: 'Your facts' })).toHaveTextContent(
    'Lot edit ATmega328P · quantity 480',
  )
})

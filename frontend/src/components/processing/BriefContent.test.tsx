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

test('the step instructions a session was queued with show under their own heading', () => {
  const guidance: BriefEntryDto = {
    kind: 'step_guidance',
    source: 'human',
    stage: 'research',
    text: 'Open the manufacturer’s own datasheet first.',
  }
  render(<BriefContent item={historyBrief([guidance])} />)

  expect(screen.getByRole('heading', { name: 'Operator guidance for this step' })).toBeVisible()
  expect(screen.getByRole('list', { name: 'Operator guidance for this step' })).toHaveTextContent(
    'Research instructions Open the manufacturer’s own datasheet first.',
  )
  // Kept apart from the operator's other facts.
  expect(screen.queryByRole('list', { name: 'Your facts' })).toBeNull()
})

test('a brief without step instructions has no guidance heading', () => {
  render(<BriefContent item={historyBrief()} />)
  expect(screen.queryByRole('heading', { name: 'Operator guidance for this step' })).toBeNull()
})

test('a brief’s Match entry says the lot’s result and what runs in which mode', () => {
  const match: BriefEntryDto = {
    kind: 'match',
    match: {
      lot_id: H.lot,
      identity: { kind: 'examine', proposal_id: H.observation },
      state: 'decided',
      generation: '2',
      settled_generation: '2',
      keys: [{ kind: 'mpn', mpn: 'CL10B104KB8NNNC', manufacturer: 'Samsung' }],
      searchable: true,
      verdict: 'exact',
      candidates: [],
      target: { part_pk: '210', name: 'CAP-0210' },
      waits: [],
      outcome: {
        schema_version: 'bench-intake-match-outcome/1',
        lot_id: H.lot,
        revision: '1',
        basis: { kind: 'decision', decision: 'add_stock' },
        research: { stage: 'research', mode: 'skipped' },
        images: { stage: 'images', mode: 'stock', part_image: false },
      },
    },
  }
  render(<BriefContent item={historyBrief([match])} />)

  expect(screen.getByRole('list', { name: 'Match' })).toHaveTextContent(
    'This lot · Add stock to CAP-0210 · CL10B104KB8NNNC + SamsungResearch skipped · stock photo',
  )
})

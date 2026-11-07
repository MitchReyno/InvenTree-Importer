import { expect, test } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { captureEditorChange, captureEditorDefaults } from '../capture/editor-model'
import { lotLocationFact } from './review-model'

const context = '60000000-0000-4000-8000-000000000006'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`

const ref = (pk: string) => ({
  observation_id: id(900 + Number(pk)),
  target_context_id: context,
  model: 'location' as const,
  pk,
})

const partId = id(10)
const [x, y] = [id(20), id(21)]

const lot = (n: number, part: string | null) => ({
  id: id(100 + n),
  label: `Lot ${n}`,
  revision: '1',
  contribution_key: id(200 + n),
  part_subject_id: part,
  quantity: { mode: 'set' as const, value: '2' },
  location: { mode: 'inherit' as const },
})

const batch = {
  id: id(1),
  target_context_id: context,
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'set', value: ref('1') } },
  parts: [
    {
      id: partId,
      label: 'Shared',
      revision: '1',
      choice: { mode: 'unset' },
      location: { mode: 'set', value: ref('2') },
    },
  ],
  group_locations: [
    { group_id: x, version: '1', location: { mode: 'set', value: ref('3') } },
    { group_id: y, version: '1', location: { mode: 'set', value: ref('4') } },
  ],
  lots: [lot(1, partId), lot(2, null), lot(3, null), lot(4, null)],
  observations: ['1', '2', '3', '4'].map((pk) => ({
    id: id(900 + Number(pk)),
    model: 'location',
    pk,
    target_context_id: context,
    label: `Drawer ${pk}`,
    observed_at: '2026-11-05T00:00:00Z',
  })),
} as unknown as CaptureSnapshotDto

const media = {
  groups: [
    { id: x, label: 'Bag X' },
    { id: y, label: 'Bag Y' },
  ],
  evidence: [
    { group_id: x, linked_subject_ids: [id(102), id(103)] },
    { group_id: y, linked_subject_ids: [id(103)] },
  ],
} as never

test('Review states where each lot location comes from', () => {
  expect(lotLocationFact(batch, batch.lots[0], media)).toEqual({
    value: 'Drawer 2 (#2) · Human choice',
    provenance: 'shared_part',
  })
  expect(lotLocationFact(batch, batch.lots[1], media)).toEqual({
    value: 'Drawer 3 (#3) · Human choice · Bag X',
    provenance: 'evidence_group',
  })
  expect(lotLocationFact(batch, batch.lots[2], media)).toEqual({
    value: 'Evidence groups assign different locations: Bag X, Bag Y',
    provenance: 'conflict',
  })
  expect(lotLocationFact(batch, batch.lots[3], media)).toEqual({
    value: 'Inherited · Drawer 1 (#1) · Human choice',
    provenance: 'inherited',
  })
})

test('without a media read, group-level lots are unconfirmed rather than defaulted', () => {
  expect(lotLocationFact(batch, batch.lots[1], undefined).provenance).toBe('unconfirmed')
  expect(lotLocationFact(batch, batch.lots[0], undefined).provenance).toBe('shared_part')
})

test('a Part edit retains a location only when the assignment changed', () => {
  const values = captureEditorDefaults(batch, partId)
  expect(captureEditorChange(batch, partId, values)).not.toHaveProperty('location')
  expect(
    captureEditorChange(batch, partId, { ...values, partLocation: { mode: 'clear' } }),
  ).toMatchObject({ kind: 'part', id: partId, location: { mode: 'clear' } })
})

test('the Review table names the location source next to the value', async () => {
  const { render, screen } = await import('@testing-library/react')
  const { createElement } = await import('react')
  const { ReviewTable } = await import('../components/operator/ReviewTable')
  const review = {
    lots: batch.lots.map((value) => ({
      lot_id: value.id,
      label: value.label,
      shared_lot_ids: [],
      predecessor_lot_ids: [],
      issues: [],
      warnings: [],
      review_state: 'not_reviewed',
      approved: false,
    })),
  } as never
  render(
    createElement(ReviewTable, {
      batch,
      review,
      media,
      lotIds: batch.lots.map((value) => value.id),
      selected: new Set<string>(),
      disabled: false,
      toggle: () => undefined,
      toggleAll: () => undefined,
      inspect: () => undefined,
    }),
  )
  expect(screen.getByText('Drawer 2 (#2) · Human choice · From shared Part')).toBeTruthy()
  expect(screen.getByText(/Bag X · From evidence group$/)).toBeTruthy()
  expect(screen.getByText(/· Groups disagree$/)).toBeTruthy()
})

test('an unset batch default with a new-location draft names the draft, never an inventory record', async () => {
  const { supplierDraftName, contextDescription } = await import('../capture/context')
  const draftId = id(700)
  const companyId = id(701)
  const drafted = {
    ...batch,
    defaults: { ...batch.defaults, location: { mode: 'unset' } },
    settings_intent: {
      value: {
        supplier: { absent: false, selection: { mode: 'draft', draft_id: companyId } },
        order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
        shared_tags: { manual: [], auto: false },
      },
      default_location_draft: draftId,
      version: '1',
      actor_id: id(2),
      created_at: '2026-11-05T00:00:00Z',
    },
    reference_drafts: [
      {
        draft_id: draftId,
        kind: 'location',
        value: { name: 'Reel shelf', description: '', parent: null },
        version: '1',
        actor_id: id(2),
        created_at: '2026-11-05T00:00:00Z',
      },
      {
        draft_id: companyId,
        kind: 'company',
        value: { name: 'Acme Reels', description: '', also_manufacturer: false, logo: null },
        version: '1',
        actor_id: id(2),
        created_at: '2026-11-05T00:00:00Z',
      },
    ],
    context: [],
  } as unknown as CaptureSnapshotDto
  expect(lotLocationFact(drafted, drafted.lots[3], media)).toEqual({
    value: 'New location Reel shelf · created only after approval',
    provenance: 'inherited',
  })
  expect(supplierDraftName(drafted)).toBe('Acme Reels')
  expect(contextDescription(drafted, null, 'supplier')).toBe(
    'New supplier Acme Reels · created only after approval',
  )
  // An explicit batch default wins, so the draft does not apply.
  expect(
    lotLocationFact({ ...drafted, defaults: batch.defaults } as never, drafted.lots[1], undefined)
      .value,
  ).not.toContain('Reel shelf')
})

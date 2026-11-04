import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { SupportedEffectPreviewDto, SupportedEffectResultDto } from '@invimport/contracts'
import { render } from '../../test/render'
import { PreparedRecordEffects } from './PreparedRecordEffects'
import { SupportedEffectResult } from '../results/SupportedEffectResult'

const id = (n: number) => `0b6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`

const location: SupportedEffectPreviewDto = {
  operation_key: id(1),
  part_subject_id: id(2),
  kind: 'create_location',
  label: 'Create new stock location',
  dependencies: [],
  inputs: { name: 'Reel shelf', description: '', parent: '43' },
}
const company: SupportedEffectPreviewDto = {
  operation_key: id(3),
  part_subject_id: id(4),
  kind: 'create_company',
  label: 'Create new supplier company',
  dependencies: [],
  inputs: {
    name: 'Acme Reels',
    description: '',
    is_supplier: 'true',
    is_manufacturer: 'true',
    image: id(5),
  },
}
const part: SupportedEffectPreviewDto = { ...location, operation_key: id(6), kind: 'create_part' }

test('approval lists new records apart from Part operations with readable inputs', () => {
  render(<PreparedRecordEffects effects={[location, company, part]} />)
  const group = screen.getByRole('region', { name: 'New inventory records' })
  expect(group).toHaveTextContent('New records · 2')
  expect(group).toHaveTextContent('Parent location: #43')
  expect(group).toHaveTextContent('Also a manufacturer: Yes')
  expect(group).toHaveTextContent('Logo: Sent with the create')
  expect(group).not.toHaveTextContent('is_supplier')
  expect(group).toHaveTextContent('an uncertain create is never repeated')
})

test('without record effects the group is absent', () => {
  render(<PreparedRecordEffects effects={[part]} />)
  expect(screen.queryByRole('region', { name: 'New inventory records' })).not.toBeInTheDocument()
})

test('results name a confirmed new record and keep an uncertain one unresolved', () => {
  const result = (certainty: 'confirmed' | 'unknown'): SupportedEffectResultDto => ({
    ...location,
    certainty,
    remote_pks: certainty === 'confirmed' ? ['12001'] : [],
    verification: null,
    recovery_action: null,
  })

  const view = render(
    <SupportedEffectResult effect={result('confirmed')} busy={false} recover={() => {}} />,
  )
  expect(screen.getByText('Created new location #12001')).toBeVisible()
  view.unmount()
  render(<SupportedEffectResult effect={result('unknown')} busy={false} recover={() => {}} />)
  expect(
    screen.getByText(
      'The new location may have been created; it is never created again for this draft',
    ),
  ).toBeVisible()
})

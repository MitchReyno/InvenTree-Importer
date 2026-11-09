import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { SupportedEffectResultDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { EffectOutcome } from './EffectOutcome'

const id = (n: number) => `0b6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`

const result = (certainty: 'confirmed' | 'unknown'): SupportedEffectResultDto => ({
  operation_key: id(1),
  part_subject_id: id(2),
  kind: 'create_location',
  label: 'Create new stock location',
  dependencies: [],
  inputs: { name: 'Reel shelf', description: '', parent: '43' },
  certainty,
  remote_pks: certainty === 'confirmed' ? ['12001'] : [],
  verification: null,
  recovery_action: null,
})

test('a confirmed new record is named and an uncertain one stays unresolved', () => {
  const view = render(
    <EffectOutcome effect={result('confirmed')} busy={false} recover={() => {}} />,
  )
  expect(screen.getByText('Created new location #12001')).toBeVisible()
  view.unmount()
  render(<EffectOutcome effect={result('unknown')} busy={false} recover={() => {}} />)
  expect(
    screen.getByText(
      'The new location may have been created; it is never created again for this draft',
    ),
  ).toBeVisible()
  expect(screen.queryByRole('link', { name: /Fix in Review/ })).not.toBeInTheDocument()
})

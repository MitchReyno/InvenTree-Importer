import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NeedsYou } from './NeedsYou'

test('a row keeps its leading step chip in its own column, apart from the wrapping text', () => {
  render(
    <NeedsYou
      items={[
        {
          id: 'q1',
          title: 'Is the last letter of the marking a P?',
          assumption: 'Assuming ATmega328P',
          step: 'Examine',
          href: '#b/processing/examine/q1',
        },
      ]}
    />,
  )
  const title = screen.getByText('Is the last letter of the marking a P?')
  const chip = screen.getByText('Examine')

  expect(title.parentElement).not.toContainElement(chip)
  expect(chip.closest('li')).toBe(title.closest('li'))
})

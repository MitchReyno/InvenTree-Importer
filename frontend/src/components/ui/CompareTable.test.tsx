import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { CompareTable } from './CompareTable'

test('sets two records side by side and marks differing fields beyond colour', () => {
  render(
    <CompareTable
      caption="This lot against existing stock"
      records={['This batch', 'Stock #1712']}
      rows={[
        { field: 'Date code', values: ['2338', '2338'] },
        { field: 'Quantity', values: ['5', '7'], differs: true },
      ]}
    />,
  )
  const table = screen.getByRole('table', { name: 'This lot against existing stock' })
  const headers = within(table).getAllByRole('columnheader')
  const quantity = within(table).getByRole('row', { name: /Quantity/ })
  const dateCode = within(table).getByRole('row', { name: /Date code/ })

  expect(headers.map((header) => header.textContent)).toEqual([
    'Field',
    'This batch',
    'Stock #1712',
  ])
  expect(within(quantity).getByRole('rowheader')).toHaveTextContent('Quantity differs')
  expect(
    within(quantity)
      .getAllByRole('cell')
      .map((cell) => cell.dataset.differs),
  ).toEqual(['true', 'true'])
  expect(within(dateCode).getByRole('rowheader')).toHaveTextContent(/^Date code$/)
})

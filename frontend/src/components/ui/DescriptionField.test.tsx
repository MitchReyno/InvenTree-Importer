import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DESCRIPTION_LIMIT, DescriptionField } from './DescriptionField'
import { SourceChip } from './SourceChip'

const companyText = 'Interconnect manufacturer: USB, board-to-board and card-edge connectors'

test('counts a company description against its limit, with its source', () => {
  render(
    <DescriptionField
      label="Company description"
      value={companyText}
      limit={DESCRIPTION_LIMIT.company}
      source={<SourceChip source="InvenTree" certainty="Existing" />}
    />,
  )

  expect(screen.getByText(companyText)).toBeInTheDocument()
  expect(screen.getByText('71 / 500')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Source: InvenTree, Existing/ })).toBeInTheDocument()
})

test('marks a description over its limit in words as well as colour', () => {
  render(<DescriptionField label="Location type description" value={'x'.repeat(263)} limit={250} />)
  const count = screen.getByText(/263 \/ 250/)

  expect(count).toHaveTextContent('263 / 250 · over the limit')
  expect(count).toHaveAttribute('data-over', 'true')
})

test('an editable description counts as the operator types', async () => {
  const onChange = vi.fn()
  render(
    <DescriptionField
      label="Part description"
      value="Resistor"
      limit={DESCRIPTION_LIMIT.default}
      onChange={onChange}
    />,
  )
  const field = screen.getByRole('textbox', { name: 'Part description' })

  expect(field).toHaveValue('Resistor')
  expect(field).toHaveAccessibleDescription(/8 \/ 250/)
  await userEvent.type(field, 's')
  expect(onChange).toHaveBeenLastCalledWith('Resistors')
})

test('a description the app cannot store yet is a disabled field with its reason', async () => {
  const reason = 'Supplier part descriptions are not stored yet.'
  render(
    <DescriptionField
      label="Supplier part description"
      value={null}
      limit={DESCRIPTION_LIMIT.default}
      disabledReason={reason}
    />,
  )
  const field = screen.getByRole('textbox', { name: 'Supplier part description' })

  expect(field).toHaveAttribute('aria-disabled', 'true')
  expect(field).toHaveAccessibleDescription(reason)
  await userEvent.type(field, 'Reel of 5000')
  expect(field).toHaveValue('')
})

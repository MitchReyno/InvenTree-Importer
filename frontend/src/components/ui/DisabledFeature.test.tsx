import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { DisabledFeature } from './DisabledFeature'

const explanation = 'Automatic logo discovery is coming soon. Upload a logo manually for now.'

test('keyboard reaches the explanation while the disabled checkbox cannot be activated', async () => {
  const user = userEvent.setup()
  render(<DisabledFeature label="Find automatically" explanation={explanation} />)
  const checkbox = screen.getByRole('checkbox', { name: 'Find automatically' })
  expect(checkbox).toBeDisabled()
  await user.tab()
  const wrapper = screen.getByRole('group', { name: 'Find automatically' })
  expect(wrapper).toHaveFocus()
  expect(wrapper).toHaveAccessibleDescription(explanation)
  await user.click(checkbox)
  expect(checkbox).not.toBeChecked()
})

test('the explanation is printed inline after the label and the eyebrow', () => {
  render(<DisabledFeature label="Find automatically" explanation={explanation} />)
  const group = screen.getByRole('group', { name: 'Find automatically' })
  expect(group).toHaveTextContent(`Find automaticallyComing later${explanation}`)
  expect(screen.getByText(explanation)).toBeVisible()
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

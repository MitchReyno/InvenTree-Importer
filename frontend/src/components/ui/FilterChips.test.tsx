import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FilterChips } from './FilterChips'

it('shows an unknown count as an ellipsis and says it is not counted yet', async () => {
  const onChange = vi.fn()
  render(
    <FilterChips
      label="Filter lots"
      value="all"
      onChange={onChange}
      options={[
        { id: 'all', label: 'All', count: 4 },
        { id: 'needs_answer', label: 'Needs answer', count: null },
      ]}
    />,
  )
  const unknown = screen.getByRole('button', { name: 'Needs answer, not counted yet' })
  expect(unknown).toHaveTextContent('Needs answer …')
  await userEvent.click(unknown)
  expect(onChange).toHaveBeenCalledWith('needs_answer')
})

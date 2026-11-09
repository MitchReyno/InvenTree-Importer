import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { AiMark } from './AiMark'

test('the mark is hidden from assistive technology; the label names the agent', () => {
  render(
    <h2>
      <AiMark>Agent sessions</AiMark>
    </h2>,
  )
  const heading = screen.getByRole('heading', { name: 'Agent sessions' })
  const mark = heading.querySelector('[data-ai-mark]')

  expect(mark).toHaveAttribute('aria-hidden', 'true')
  expect(mark?.querySelector('svg')).not.toBeNull()
  expect(heading).toHaveTextContent(/^Agent sessions$/)
})

test.each(['sm', 'md', 'lg'] as const)('the %s tile can stand alone', (size) => {
  const { container } = render(<AiMark size={size} />)

  expect(container.querySelector('[data-ai-mark]')).toHaveAttribute('data-size', size)
})

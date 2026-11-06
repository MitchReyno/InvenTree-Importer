import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AgentLine } from './AgentLine'

it('names the step and its latest line, and opens that step in Processing', () => {
  render(
    <AgentLine
      batchId="b"
      status={{ step: 'research', text: 'Checking the datasheet', state: 'waiting_input' }}
    />,
  )
  const line = screen.getByRole('status', { name: 'Agent' })
  expect(line).toHaveTextContent('Research · Checking the datasheet')
  expect(line).toHaveTextContent('Waiting for you')
  expect(screen.getByRole('link', { name: 'Open in Processing' })).toHaveAttribute(
    'href',
    '#b/processing/research',
  )
})

it('shows nothing for a lot no session works on', () => {
  const { container } = render(<AgentLine batchId="b" status={null} />)
  expect(container).toBeEmptyDOMElement()
})

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { debugModeController } from '#/debug/debug-mode'
import { DebugDetails } from './DebugDetails'
import { DebugPanel } from './DebugPanel'

beforeEach(() => {
  window.localStorage.clear()
  act(() => debugModeController().setEnabled(false))
})

test('debug details render nothing while debug mode is off', () => {
  render(<DebugDetails label="Round details" rows={[{ label: 'Run', value: 'run_5d1e' }]} />)

  expect(screen.queryByText('run_5d1e')).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: /Round details/ })).not.toBeInTheDocument()
})

test('debug details appear as a marked block as soon as debug mode is on', () => {
  render(<DebugDetails label="Round details" rows={[{ label: 'Run', value: 'run_5d1e' }]} />)

  act(() => debugModeController().setEnabled(true))

  const block = screen.getByRole('group', { name: 'Debug: Round details' })
  expect(block).toHaveTextContent('Debug')
  expect(block).toHaveTextContent('Run')
  expect(block).toHaveTextContent('run_5d1e')
})

test('the debug panel is collapsible and only shown in debug mode', () => {
  const { rerender } = render(
    <DebugPanel screen="Processing" rows={[{ label: 'Route', value: '#b/processing' }]} />,
  )
  expect(screen.queryByText(/Debug · Processing/)).not.toBeInTheDocument()

  act(() => debugModeController().setEnabled(true))
  rerender(<DebugPanel screen="Processing" rows={[{ label: 'Route', value: '#b/processing' }]} />)

  const summary = screen.getByText('Debug · Processing')
  const panel = summary.closest('details')
  expect(panel).not.toHaveAttribute('open')
  fireEvent.click(summary)
  expect(panel).toHaveAttribute('open')
  expect(screen.getByText('#b/processing')).toBeInTheDocument()
})

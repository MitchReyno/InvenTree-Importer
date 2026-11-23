import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { RefreshSignal, REFRESH_LINE_DELAY_MS } from '#/components/operations/RefreshSignal'
import { ReadState } from './ReadState'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('an empty read shows the page skeleton, announced as loading, and no page', async () => {
  render(
    <ReadState phase="empty" skeleton={<div data-testid="skeleton" />}>
      <p>Page</p>
    </ReadState>,
  )
  expect(screen.getByTestId('skeleton')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.queryByText('Page')).not.toBeInTheDocument()
})

test('cached data shows at once with no message in the page', async () => {
  render(
    <ReadState phase="cached" skeleton={<div data-testid="skeleton" />}>
      <p>Page</p>
    </ReadState>,
  )
  expect(screen.getByText('Page')).toBeInTheDocument()
  expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('a failed read keeps its banner and the last data', async () => {
  render(
    <ReadState
      phase="failed"
      skeleton={<div data-testid="skeleton" />}
      failure={<p>Unavailable</p>}
    >
      <p>Page</p>
    </ReadState>,
  )
  expect(screen.getByText('Unavailable')).toBeInTheDocument()
  expect(screen.getByText('Page')).toBeInTheDocument()
})

test('a failed read with nothing to show keeps its banner without a skeleton', async () => {
  render(
    <ReadState
      phase="failed"
      hasData={false}
      skeleton={<div data-testid="skeleton" />}
      failure={<p>Unavailable</p>}
    >
      <p>Page</p>
    </ReadState>,
  )
  expect(screen.getByText('Unavailable')).toBeInTheDocument()
  expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument()
  expect(screen.queryByText('Page')).not.toBeInTheDocument()
})

test('a refreshing read reports to the page’s refresh signal', async () => {
  render(
    <RefreshSignal>
      <ReadState phase="refreshing" skeleton={null}>
        <p>Page</p>
      </ReadState>
    </RefreshSignal>,
  )
  await act(() => vi.advanceTimersByTime(REFRESH_LINE_DELAY_MS))
  expect(screen.getByTestId('refresh-line')).toBeInTheDocument()
})

test('a read that fails and recovers keeps the page mounted, with its input', async () => {
  const view = render(
    <ReadState phase="cached" skeleton={null} failure={<p>Unavailable</p>}>
      <input aria-label="Draft" defaultValue="" />
    </ReadState>,
  )
  const input = screen.getByLabelText('Draft')
  ;(input as HTMLInputElement).value = 'typed'
  view.rerender(
    <ReadState phase="failed" skeleton={null} failure={<p>Unavailable</p>}>
      <input aria-label="Draft" defaultValue="" />
    </ReadState>,
  )
  view.rerender(
    <ReadState phase="current" skeleton={null} failure={<p>Unavailable</p>}>
      <input aria-label="Draft" defaultValue="" />
    </ReadState>,
  )
  expect(screen.getByLabelText('Draft')).toBe(input)
  expect(input).toHaveValue('typed')
})

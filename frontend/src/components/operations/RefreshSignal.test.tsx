import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { useReportRefreshing } from '#/context'
import { RefreshSignal, REFRESH_LINE_DELAY_MS, REFRESH_STATUS_DELAY_MS } from './RefreshSignal'

let setRefreshing: (refreshing: boolean) => void = () => undefined

function Read() {
  const [refreshing, set] = useState(false)
  setRefreshing = set
  useReportRefreshing(refreshing)
  return <p>Page content</p>
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('shows nothing for 400 ms, then the line, then “Updating…” after 3 s, without moving the page', async () => {
  render(
    <RefreshSignal>
      <Read />
    </RefreshSignal>,
  )
  const content = screen.getByText('Page content')
  act(() => setRefreshing(true))
  await act(() => vi.advanceTimersByTime(REFRESH_LINE_DELAY_MS - 1))
  expect(screen.queryByTestId('refresh-line')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()

  await act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('refresh-line')).toBeInTheDocument()
  // Announced, without visible words yet.
  expect(screen.getByRole('status')).toHaveTextContent('Updating')
  expect(screen.queryByText('Updating…')).not.toBeInTheDocument()

  await act(() => vi.advanceTimersByTime(REFRESH_STATUS_DELAY_MS - REFRESH_LINE_DELAY_MS))
  expect(screen.getByText('Updating…')).toBeInTheDocument()
  // The signal sits in a zero-height layer before the content, so nothing below it moves.
  expect(screen.getByTestId('refresh-anchor').compareDocumentPosition(content)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )

  act(() => setRefreshing(false))
  expect(screen.queryByTestId('refresh-line')).not.toBeInTheDocument()
  expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
})

test('a refresh that lands within 400 ms shows nothing', async () => {
  render(
    <RefreshSignal>
      <Read />
    </RefreshSignal>,
  )
  act(() => setRefreshing(true))
  await act(() => vi.advanceTimersByTime(200))
  act(() => setRefreshing(false))
  await act(() => vi.advanceTimersByTime(REFRESH_STATUS_DELAY_MS))
  expect(screen.queryByTestId('refresh-line')).not.toBeInTheDocument()
})

test('the line holds still under reduced motion', async () => {
  render(
    <RefreshSignal>
      <Read />
    </RefreshSignal>,
  )
  act(() => setRefreshing(true))
  await act(() => vi.advanceTimersByTime(REFRESH_LINE_DELAY_MS))
  const line = screen.getByTestId('refresh-line')
  const rules = [...document.querySelectorAll('style')].map((style) => style.textContent).join('')
  const lineClass = [...line.classList].find((name) => rules.includes(`.${name}`))
  expect(lineClass).toBeDefined()
  expect(rules).toMatch(
    new RegExp(`prefers-reduced-motion: reduce\\)\\{\\.${lineClass}\\{animation:none;\\}`),
  )
})

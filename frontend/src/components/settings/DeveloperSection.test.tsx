import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEBUG_STORAGE_KEY, debugModeController } from '#/debug/debug-mode'
import { render } from '#/test/render'
import { DeveloperSection } from './DeveloperSection'

const readiness = {
  status: 'ready',
  api_version: 'bench-intake-app/1',
  deployment: 'restricted-local-development',
  identity: 'deferred_T11',
  web: 'unavailable',
  media: 'configured',
  updates: 'websocket-with-polling-fallback',
  apply: 'separately-supervised-owned-fake-only',
}

function readinessTransport(ok = true, overrides: Partial<typeof readiness> = {}) {
  return vi.fn(async () =>
    ok
      ? new Response(JSON.stringify({ ...readiness, ...overrides }), {
          headers: { 'content-type': 'application/json' },
        })
      : new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
  )
}

beforeEach(() => {
  window.localStorage.clear()
  act(() => debugModeController().setEnabled(false))
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

test('switching debug mode on stores it on this device', async () => {
  vi.stubGlobal('fetch', readinessTransport())
  render(<DeveloperSection />)

  const debugSwitch = screen.getByRole('switch', { name: 'Show debug details' })
  expect(debugSwitch).not.toBeChecked()
  fireEvent.click(debugSwitch)

  expect(debugSwitch).toBeChecked()
  expect(window.localStorage.getItem(DEBUG_STORAGE_KEY)).toBe('on')
  await screen.findByText('Reachable · compatible application version')
})

test('the local setup check runs when the section opens and reports the web state', async () => {
  const transport = readinessTransport()
  vi.stubGlobal('fetch', transport)
  render(<DeveloperSection />)

  await screen.findByText('Reachable · compatible application version')
  expect(transport).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Unavailable for this profile')).toBeInTheDocument()
  expect(screen.queryByLabelText(/credential|key|password/i)).not.toBeInTheDocument()
})

test('the local setup check shows its skeleton, not a checking line, until it is read', async () => {
  vi.stubGlobal('fetch', readinessTransport())
  render(<DeveloperSection />)

  expect(screen.queryByText(/Checking local setup/)).not.toBeInTheDocument()
  expect(screen.getByText('Loading')).toHaveAttribute('role', 'status')
  await screen.findByText('Reachable · compatible application version')
  expect(screen.queryByText('Loading')).not.toBeInTheDocument()
})

test('the local setup check shows web access when the VM tool profile has it', async () => {
  vi.stubGlobal('fetch', readinessTransport(true, { web: 'available' }))
  render(<DeveloperSection />)

  expect(await screen.findByText('Available in VM sessions')).toBeInTheDocument()
})

test('a failed local setup check says so and the tools still work', async () => {
  vi.stubGlobal('fetch', readinessTransport(false))
  render(<DeveloperSection />)

  expect(await screen.findByRole('alert')).toHaveTextContent('Local setup checks are unavailable')
  expect(screen.getByRole('button', { name: 'Copy debug info' })).toBeEnabled()
})

test('Copy debug info copies the route and setup, and no secrets', async () => {
  vi.stubGlobal('fetch', readinessTransport())
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  window.location.hash = '#settings/developer'
  window.localStorage.setItem('planted-token', 'secret-token-value')
  render(<DeveloperSection />)
  await screen.findByText('Reachable · compatible application version')

  fireEvent.click(screen.getByRole('button', { name: 'Copy debug info' }))

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  const text = (writeText.mock.calls[0] as unknown as [string])[0]
  expect(text).toContain('Route: settings/developer')
  expect(text).toContain('API version: bench-intake-app/1')
  expect(text).not.toContain('secret-token-value')
  expect(await screen.findByText('Debug info copied.')).toBeInTheDocument()
})

test('a refused clipboard says it could not copy', async () => {
  vi.stubGlobal('fetch', readinessTransport())
  const writeText = vi.fn(async () => {
    throw new DOMException('denied', 'NotAllowedError')
  })
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  render(<DeveloperSection />)

  fireEvent.click(screen.getByRole('button', { name: 'Copy debug info' }))

  expect(
    await screen.findByText("Couldn't copy: the browser refused clipboard access."),
  ).toBeInTheDocument()
})

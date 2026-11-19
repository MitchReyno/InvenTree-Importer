import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { debugModeController } from '#/debug/debug-mode'
import { render } from '#/test/render'
import { stubPhoneViewport } from '#/test/viewport'
import { DevModeButton } from './DevModeButton'

const readiness = {
  status: 'ready',
  api_version: 'bench-intake-app/1',
  deployment: 'restricted-local-development',
  identity: 'deferred_T11',
  research: 'unqualified',
  media: 'configured',
  updates: 'websocket-with-polling-fallback',
  apply: 'separately-supervised-owned-fake-only',
}

function transport(ok = true) {
  return vi.fn(async () =>
    ok
      ? new Response(JSON.stringify(readiness), {
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
  act(() => debugModeController().setEnabled(false))
})

test('the pill opens developer tools by keyboard, switches debug mode and closes on Escape', async () => {
  const fetch = transport()
  vi.stubGlobal('fetch', fetch)
  const user = userEvent.setup()
  render(<DevModeButton />)
  const pill = screen.getByRole('button', { name: 'Dev mode: open developer tools' })
  expect(pill).toHaveTextContent('Dev mode')
  expect(fetch).not.toHaveBeenCalled()

  pill.focus()
  await user.keyboard('{Enter}')

  const tools = await screen.findByRole('dialog', { name: 'Developer tools' })
  expect(pill).toHaveAttribute('aria-expanded', 'true')
  expect(tools).toHaveTextContent('Development build')
  expect(await screen.findByText('Reachable')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Check setup again' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reload app data' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy debug info' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Developer settings' })).toHaveAttribute(
    'href',
    '#settings/developer',
  )

  await user.click(screen.getByRole('switch', { name: 'Debug mode' }))
  expect(debugModeController().enabled()).toBe(true)

  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Developer tools' })).not.toBeInTheDocument(),
  )
  expect(pill).toHaveFocus()
})

test('at phone width the shortened pill keeps its full name and opens the same tools', async () => {
  const restore = stubPhoneViewport()
  vi.stubGlobal('fetch', transport())
  const user = userEvent.setup()
  render(<DevModeButton />)

  const pill = screen.getByRole('button', { name: 'Dev mode: open developer tools' })
  expect(within(pill).getByText('mode', { exact: false })).toBeInTheDocument()
  await user.click(pill)

  expect(await screen.findByRole('dialog', { name: 'Developer tools' })).toHaveTextContent(
    'Debug mode',
  )
  restore()
})

test('when local setup cannot be read the popover says so and the tools still work', async () => {
  vi.stubGlobal('fetch', transport(false))
  const user = userEvent.setup()
  render(<DevModeButton />)

  await user.click(screen.getByRole('button', { name: 'Dev mode: open developer tools' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Local setup checks are unavailable')
  await user.click(screen.getByRole('switch', { name: 'Debug mode' }))
  expect(debugModeController().enabled()).toBe(true)
  expect(screen.getByRole('button', { name: 'Copy debug info' })).toBeEnabled()
})

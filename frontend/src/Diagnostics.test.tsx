import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Diagnostics } from './components/operations/Diagnostics'
import { render } from './test/render'

afterEach(() => vi.unstubAllGlobals())

test('diagnostics loads only when opened and describes unavailable research without credentials', async () => {
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 'ready',
          api_version: 'bench-intake-app/1',
          deployment: 'restricted-local-development',
          identity: 'deferred_T11',
          research: 'unqualified',
          media: 'disabled',
          updates: 'websocket-with-polling-fallback',
          apply: 'separately-supervised-owned-fake-only',
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  )
  vi.stubGlobal('fetch', transport)
  render(<Diagnostics />)
  expect(transport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Local setup and diagnostics'))
  await waitFor(() =>
    expect(screen.getByText('Reachable · compatible application version')).toBeInTheDocument(),
  )
  expect(transport).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Unavailable pending provider qualification')).toBeInTheDocument()
  expect(screen.queryByLabelText(/credential|key|password/i)).not.toBeInTheDocument()
})

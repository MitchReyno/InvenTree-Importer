import { act, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ProviderStatusDto } from '@invimport/contracts'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { deferred } from '#/test/deferred'
import { fixtureScope, render } from '#/test/render'
import { POLL_MS, useProviderStatus, type ProviderStatusState } from './useProviderStatus'

const CHECKED_AT = '2026-11-24T05:00:00.000Z'

function status(
  claude: 'saved' | 'not_saved',
  codex: ProviderStatusDto['codex'] = {
    state: 'signed_out',
    checked_at: CHECKED_AT,
    refreshing: false,
    last_sign_in_failure: null,
  },
): ProviderStatusDto {
  return {
    claude:
      claude === 'saved'
        ? { state: 'saved', saved_at: null, checked_at: CHECKED_AT, last_sign_in_failure: null }
        : { state: 'not_saved', checked_at: CHECKED_AT, last_sign_in_failure: null },
    codex,
    read_at: CHECKED_AT,
  }
}

const codexRefreshing: ProviderStatusDto['codex'] = {
  state: 'signed_in',
  checked_at: CHECKED_AT,
  refreshing: true,
  last_sign_in_failure: null,
}

const codexChecking: ProviderStatusDto['codex'] = {
  state: 'unknown',
  reason: 'checking',
  last_sign_in_failure: null,
}

/** Renders the hook, handing its latest state to the test. */
function renderStatus(
  providerStatus: (options?: { refresh?: boolean }) => Promise<ProviderStatusDto>,
) {
  const cache = createServerQueryClient()
  const latest: { current?: ProviderStatusState; shown?: (value: boolean) => void } = {}

  function Probe() {
    latest.current = useProviderStatus({ providerStatus })
    return null
  }

  function Host() {
    const [shown, setShown] = useState(true)
    latest.shown = setShown
    return shown ? <Probe /> : null
  }

  render(<Host />, { cache })
  return { cache, latest: latest as Required<typeof latest> }
}

afterEach(() => {
  vi.useRealTimers()
})

test('a sign-in change in the same moment as Check again still gets a fresh read of its own', async () => {
  const first = deferred<ProviderStatusDto>()
  const calls: boolean[] = []
  const providerStatus = vi.fn(async (options?: { refresh?: boolean }) => {
    calls.push(options?.refresh === true)
    if (calls.length === 2) {
      return first.promise
    }
    // The change's own fresh read finds a token saved again elsewhere since.
    return status('saved')
  })
  const { latest } = renderStatus(providerStatus)
  await waitFor(() => expect(latest.current.claude.pill.word).toBe('Token saved'))

  act(() => {
    void latest.current.checkAgain()
    latest.current.signInChanged('claude', 'not_saved')
  })
  expect(latest.current.claude.pill.word).toBe('No token')
  // Both joined the first fresh read, which answers with the VM before the change; the change
  // then asks again with a fresh read of its own, which settles it.
  await act(async () => first.resolve(status('saved')))
  await waitFor(() => expect(calls.filter(Boolean).length).toBeGreaterThanOrEqual(2))
  // Settled by its own read, the card follows the VM again.
  await waitFor(() => expect(latest.current.claude.pill.word).toBe('Token saved'))
  expect(calls.at(-1)).toBe(true)
  expect(providerStatus).toHaveBeenCalledTimes(3)
})

test('a fresh read cancelled by a live hint asks again instead of settling on a plain read', async () => {
  const held = deferred<ProviderStatusDto>()
  const calls: boolean[] = []
  const providerStatus = vi.fn(async (options?: { refresh?: boolean }) => {
    calls.push(options?.refresh === true)
    if (calls.length === 2) {
      return held.promise
    }
    return status(calls.length === 1 ? 'saved' : 'not_saved')
  })
  const { cache, latest } = renderStatus(providerStatus)
  await waitFor(() => expect(latest.current.claude.pill.word).toBe('Token saved'))

  act(() => latest.current.signInChanged('claude', 'not_saved'))
  await waitFor(() => expect(calls).toEqual([false, true]))
  // A live hint cancels every read in the scope, the fresh one included.
  await act(() =>
    cache.cancelQueries({ queryKey: serverQueryKey(fixtureScope, 'provider-status') }),
  )
  await waitFor(() => expect(calls.filter(Boolean).length).toBe(2))
  expect(latest.current.claude.pill.word).toBe('No token')
})

test('a failed read ends a run, so coming back starts a new one rather than reviving a change', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })

  let answer: () => Promise<ProviderStatusDto> = async () => status('saved')

  const providerStatus = vi.fn(() => answer())
  const { latest } = renderStatus(providerStatus)
  await waitFor(() => expect(latest.current.codex.pill.word).toBe('Not signed in'))

  // Signed in; the VM's check of the new account runs, so the card shows the confirmation.
  answer = async () => status('saved', codexRefreshing)
  act(() => latest.current.signInChanged('codex', 'signed_in'))
  await waitFor(() => expect(latest.current.codex.refreshing).toBe(true))
  expect(latest.current.codex.pill.word).toBe('Signed in')

  // The next read fails: the wait ends, and the card says so, aloud too.
  answer = async () => {
    throw new Error('status_read_failed')
  }
  await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
  await waitFor(() => expect(latest.current.codex.pill.word).toBe('Status unavailable'))
  expect(latest.current.codex.announcement).toBe('Codex: Status unavailable')

  // Leaving and coming back while the VM still checks: its own checking, not the old change.
  act(() => latest.shown(false))
  answer = async () => status('saved', codexChecking)
  act(() => latest.shown(true))
  await waitFor(() => expect(latest.current.codex.pill.word).toBe('Checking…'))
  expect(latest.current.codex.refreshing).toBe(false)
})

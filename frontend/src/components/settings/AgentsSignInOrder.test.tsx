import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { AgentModelCatalogRefreshReceiptDto, ProviderStatusDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { deferred } from '#/test/deferred'
import { render } from '#/test/render'
import { agentSettings } from '#/test/agent-settings'
import { modelCatalog } from '#/test/model-catalog'
import { Settings } from './Settings'

vi.mock('#/debug/useReadiness', () => ({ useReadiness: () => ({ data: { web: 'available' } }) }))

// The ChatGPT dialog stands in for the runner flow: one button per account change it reports.
vi.mock('#/components/agents/ChatGPTSignIn', () => ({
  ChatGPTSignIn: ({
    onConfirmed,
    onChanged,
  }: {
    onConfirmed: () => void
    onChanged: () => void
  }) => (
    <>
      <button onClick={onConfirmed}>Account confirmed</button>
      <button onClick={onChanged}>Disconnected</button>
    </>
  ),
}))

const CHECKED = '2026-11-26T00:00:00.000Z'

test('an older sign-in confirmation still marking the list never shows over a newer disconnect', async () => {
  const signedOut: ProviderStatusDto = {
    claude: { state: 'saved', saved_at: null, checked_at: CHECKED, last_sign_in_failure: null },
    codex: {
      state: 'signed_out',
      checked_at: CHECKED,
      refreshing: false,
      last_sign_in_failure: null,
    },
    read_at: CHECKED,
  }
  const first = deferred<AgentModelCatalogRefreshReceiptDto>()
  const refreshModelCatalog = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ provider: 'codex', authentication: 'subscription', stale_sign_in: true })
  const api = {
    settings: vi.fn(async () =>
      agentSettings('7', { provider: 'claude', authentication: 'subscription', model: 'sonnet' }),
    ),
    saveSettings: vi.fn(),
    sessions: vi.fn(async () => ({
      batches: [],
      sessions: [],
      next_before: null,
      totals: { slots_in_use: 0, queued: 0, waiting: 0 },
      paused_batch_ids: [],
      paused_truncated: false,
    })),
    pauseAll: vi.fn(),
    // The fresh reads the changes ask for stay unanswered, so the card shows what was published.
    providerStatus: vi
      .fn()
      .mockResolvedValueOnce(signedOut)
      .mockReturnValue(new Promise(() => {})),
    modelCatalog: vi.fn(async () => modelCatalog()),
    refreshModelCatalog,
  }
  render(
    <Settings
      section="agents"
      returnTo={undefined}
      agents={api as unknown as ReturnType<typeof agentsClient>}
      onDirtyChange={vi.fn()}
      replaceSubsection={vi.fn()}
    />,
  )
  await screen.findByRole('group', { name: 'Codex' })
  fireEvent.click(screen.getByRole('button', { name: 'Account confirmed' }))
  fireEvent.click(screen.getByRole('button', { name: 'Disconnected' }))
  await waitFor(() => expect(refreshModelCatalog).toHaveBeenCalledTimes(2))
  await act(async () =>
    first.resolve({ provider: 'codex', authentication: 'subscription', stale_sign_in: true }),
  )
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  // The disconnect was the newer change: the card waits on the VM rather than saying signed in.
  expect(screen.getByRole('group', { name: 'Codex' })).not.toHaveAccessibleDescription('Signed in')
})

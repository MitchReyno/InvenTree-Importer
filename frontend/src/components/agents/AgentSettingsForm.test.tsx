import { screen, fireEvent, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import { AgentSettingsForm } from './AgentSettingsForm'
import type { agentsClient } from '@invimport/contracts/client'

const initial = {
  revision: '7',
  selection: { provider: 'claude', authentication: 'subscription', model: 'sonnet' },
} as const

function client() {
  return {
    settings: vi.fn(async () => initial),
    saveSettings: vi.fn(async () => ({ ...initial, revision: '8' })),
    sessions: vi.fn(),
  } satisfies ReturnType<typeof agentsClient>
}

test('saving the global default pins the loaded revision and clears the dirty guard only on confirmation', async () => {
  const api = client()
  const dirty = vi.fn()
  render(<AgentSettingsForm initial={initial} client={api} onDirtyChange={dirty} />)
  fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'opus' } })
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(api.saveSettings).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save default' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith({
      expected_revision: '7',
      selection: { provider: 'claude', authentication: 'subscription', model: 'opus' },
    }),
  )
  await screen.findByText(/New attempts use this selection/)
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('a failed save preserves the draft, route and expected revision rather than silently adopting a newer setting', async () => {
  const api = client()
  api.saveSettings.mockRejectedValue(new Error('revision_conflict'))
  const dirty = vi.fn()
  const { rerender } = render(
    <AgentSettingsForm initial={initial} client={api} onDirtyChange={dirty} />,
  )
  fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'custom-model' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save default' }))
  await screen.findByText(/Save was not confirmed/)
  rerender(
    <AgentSettingsForm
      initial={{ ...initial, revision: '9' }}
      client={api}
      onDirtyChange={dirty}
    />,
  )
  expect(screen.getByLabelText('Default model')).toHaveValue('custom-model')
  expect(dirty).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Discard and reload' }))
  await waitFor(() => expect(screen.getByLabelText('Default model')).toHaveValue('sonnet'))
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('switching providers requires choosing a new model and shows host authentication instructions without secret fields', () => {
  render(<AgentSettingsForm initial={initial} client={client()} onDirtyChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'codex' } })
  expect(screen.getByLabelText('Default model')).toHaveValue('')
  expect(screen.getByText(/codex login/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'api_key' } })
  expect(screen.getByText('OPENAI_API_KEY')).toBeVisible()
  expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
})

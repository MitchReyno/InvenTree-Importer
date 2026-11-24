import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentSettingsDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { agentSettings } from '#/test/agent-settings'
import { agentSettingsServer, type AgentSettingsServer } from '#/test/agent-settings-server'
import { Settings } from './Settings'

vi.mock('#/debug/useReadiness', () => ({
  useReadiness: () => ({ data: { web: 'available' } }),
}))

const claude = { provider: 'claude', authentication: 'subscription', model: 'opus' } as const
const bothOn = agentSettings('7', claude, {
  providers: {
    claude: { enabled: true, authentication: 'subscription', default_model: 'opus' },
    codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-6.1-sol' },
  },
})

type DirtyReport = { dirty: boolean; beforeLeave?: () => Promise<boolean> }

/** Renders Settings › Agents over the fake server, then moves to fake timers. */
async function renderAgents(initial: AgentSettingsDto = agentSettings('7', claude)) {
  const server = agentSettingsServer(initial)
  const reports: DirtyReport[] = []
  const { unmount } = render(
    <Settings
      section="agents"
      returnTo={undefined}
      agents={server.asClient()}
      onDirtyChange={(dirty, beforeLeave) => {
        reports.push({ dirty, beforeLeave })
      }}
    />,
  )
  await screen.findByRole('group', { name: 'Claude' })
  vi.useFakeTimers()
  return { server, reports, unmount, dirty: () => reports.at(-1)?.dirty ?? false }
}

/** Lets timers and the promises they start run. */
async function wait(ms = 0) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

function stepper() {
  return within(screen.getAllByRole('group', { name: 'Sessions at once' }).at(-1)!)
}

function moreSessions() {
  fireEvent.click(stepper().getByRole('button', { name: 'One more' }))
}

function toggleTags() {
  fireEvent.click(screen.getByRole('switch', { name: 'Suggest tags for new batches' }))
}

function providerSwitch(provider: 'Claude' | 'Codex') {
  return within(screen.getByRole('group', { name: provider })).getByRole('switch', { name: 'On' })
}

/** Picks an option in a step's or a card's model picker, by searching for it first. */
function pick(picker: HTMLElement, option: string, search = option.split(' · ').at(-1)!) {
  fireEvent.change(picker, { target: { value: search } })
  fireEvent.click(screen.getByRole('option', { name: option }))
}

function stepPicker(step: string) {
  return within(screen.getByRole('group', { name: step })).getByRole('combobox', { name: step })
}

/** A subsection, whose heading carries its save status. */
function heading(name: string) {
  return screen.getAllByRole('region', { name })[0]
}

afterEach(() => {
  vi.useRealTimers()
})

describe('non-text settings save as they change', () => {
  test('stepper clicks within the debounce send one save of the last value, Saving… then Saved', async () => {
    const { server } = await renderAgents()
    moreSessions()
    await wait(300)
    moreSessions()
    expect(screen.getByText('Sessions: Unsaved changes · saving shortly')).toBeVisible()
    await wait(599)
    expect(server.sent()).toHaveLength(0)
    const release = server.hold()
    await wait(1)
    expect(server.sent()).toHaveLength(1)
    expect(screen.getByText('Sessions: Saving…')).toBeVisible()
    release()
    await wait()
    expect(server.sent()[0]).toMatchObject({ expected_revision: '7', session_concurrency: 5 })
    expect(screen.getByText('Sessions: Saved')).toBeVisible()
    expect(within(heading('Sessions')).queryByRole('button', { name: 'Save' })).toBeNull()
  })

  test('a save is built when sent: newest confirmed settings plus only its own fields, never a text draft', async () => {
    const { server } = await renderAgents()
    fireEvent.change(screen.getByRole('textbox', { name: 'Instructions for every new batch' }), {
      target: { value: 'Half-typed instructions' },
    })
    const release = server.hold()
    moreSessions()
    await wait(600)
    // Queued behind the running save; built only once it has confirmed.
    toggleTags()
    await wait(600)
    expect(server.sent()).toHaveLength(1)
    release()
    await wait()
    expect(server.sent()).toHaveLength(2)
    expect(server.sent()[1]).toMatchObject({
      expected_revision: '8',
      session_concurrency: 4,
      auto_tags_default: true,
      new_batch_instructions: '',
    })
    expect(server.sent()[0].save_id).not.toBe(server.sent()[1].save_id)
    expect(server.saved.revision).toBe('9')
  })

  test('an edit made while its own save is in flight saves again after it, and holds the guard until then', async () => {
    const { server, dirty } = await renderAgents()
    const release = server.hold()
    moreSessions()
    await wait(600)
    moreSessions()
    release()
    await wait()
    expect(server.sent().map((request) => request.session_concurrency)).toEqual([4])
    // Only the value actually sent was acknowledged.
    expect(dirty()).toBe(true)
    await wait(600)
    expect(server.sent().map((request) => request.session_concurrency)).toEqual([4, 5])
    expect(server.sent()[1].expected_revision).toBe('8')
    expect(dirty()).toBe(false)
  })

  test('a switch change saves on its own and releases the guard once confirmed', async () => {
    const { server, dirty } = await renderAgents()
    fireEvent.click(screen.getByRole('switch', { name: 'Allow public web pages' }))
    expect(dirty()).toBe(true)
    await wait(600)
    expect(server.saved.web).toEqual({ public_pages: false, prefer_datasheets: true })
    expect(screen.getByText('Web research: Saved')).toBeVisible()
    expect(dirty()).toBe(false)
  })
})

describe('conflicts and lost acknowledgements', () => {
  test('an external conflict pauses the queue, keeps the value, and Reload shows what is saved', async () => {
    const { server, dirty } = await renderAgents()
    server.otherTab({ new_batch_instructions: 'From the other tab' })
    toggleTags()
    await wait(600)
    const status = within(heading('Tag suggestions')).getByRole('alert')
    expect(status).toHaveTextContent('Tag suggestions: Not saved: changed in another tab')
    expect(screen.getByRole('switch', { name: 'Suggest tags for new batches' })).toBeChecked()
    expect(within(status).getByRole('button', { name: 'Try the same save again' })).toBeVisible()
    // Later saves wait while the outcome is contested.
    moreSessions()
    await wait(600)
    expect(server.sent()).toHaveLength(1)
    expect(dirty()).toBe(true)

    fireEvent.click(within(status).getByRole('button', { name: /Reload/ }))
    await wait()
    expect(screen.getByRole('switch', { name: 'Suggest tags for new batches' })).not.toBeChecked()
    expect(within(heading('Tag suggestions')).queryByRole('alert')).not.toBeInTheDocument()
    // The queue resumes; the queued edit keeps the revision it was made over, so it meets the
    // same conflict rather than overwriting the other tab's change unseen.
    await wait(600)
    expect(server.sent()).toHaveLength(2)
    expect(server.sent()[1]).toMatchObject({ expected_revision: '7', session_concurrency: 4 })
    expect(within(heading('Sessions')).getByRole('alert')).toHaveTextContent(
      'Not saved: changed in another tab',
    )
    fireEvent.click(
      within(heading('Sessions')).getByRole('button', { name: 'Try the same save again' }),
    )
    await wait()
    expect(server.saved).toMatchObject({
      revision: '9',
      session_concurrency: 4,
      auto_tags_default: false,
      new_batch_instructions: 'From the other tab',
    })
    expect(dirty()).toBe(false)
  })

  test('Try again after a conflict re-sends the change over the new revision, with a new ID', async () => {
    const { server } = await renderAgents()
    server.otherTab({ session_concurrency: 6 })
    toggleTags()
    await wait(600)
    fireEvent.click(
      within(heading('Tag suggestions')).getByRole('button', { name: 'Try the same save again' }),
    )
    await wait()
    expect(server.sent()).toHaveLength(2)
    expect(server.sent()[1]).toMatchObject({
      expected_revision: '8',
      auto_tags_default: true,
      session_concurrency: 6,
    })
    expect(server.sent()[1].save_id).not.toBe(server.sent()[0].save_id)
    expect(screen.getByText('Tag suggestions: Saved')).toBeVisible()
  })

  test('a lost acknowledgement without a commit pauses the queue and is resent with the same ID', async () => {
    const { server } = await renderAgents()
    server.deliver('lost-before-commit')
    toggleTags()
    await wait(600)
    expect(within(heading('Tag suggestions')).getByRole('alert')).toHaveTextContent(
      'Save not confirmed',
    )
    moreSessions()
    await wait(600)
    expect(server.sent()).toHaveLength(1)
    await wait(1000)
    expect(server.sent()).toHaveLength(3)
    expect(server.sent()[1]).toEqual(server.sent()[0])
    expect(server.sent()[2]).toMatchObject({ expected_revision: '8', session_concurrency: 4 })
    expect(server.saved).toMatchObject({ revision: '9', auto_tags_default: true })
  })

  test('a lost acknowledgement after a commit is confirmed by its receipt, then the settings are read', async () => {
    const { server } = await renderAgents()
    server.deliver('lost-after-commit')
    toggleTags()
    await wait(600)
    const reads = server.client.settings.mock.calls.length
    fireEvent.click(
      within(heading('Tag suggestions')).getByRole('button', { name: 'Try the same save again' }),
    )
    await wait()
    expect(server.sent()[1]).toEqual(server.sent()[0])
    expect(server.client.settings.mock.calls.length).toBe(reads + 1)
    expect(server.saved.revision).toBe('8')
    expect(screen.getByText('Tag suggestions: Saved')).toBeVisible()
  })

  test('a save that times out and commits after a recovery read is confirmed by resending its ID', async () => {
    const { server } = await renderAgents()
    server.deliver('late-commit')
    toggleTags()
    await wait(600)
    // A read in the meantime still shows the old settings.
    expect((await server.client.settings()).revision).toBe('7')
    server.commitLate()
    await wait(1000)
    expect(server.sent()[1].save_id).toBe(server.sent()[0].save_id)
    expect(server.saved.revision).toBe('8')
    expect(screen.getByText('Tag suggestions: Saved')).toBeVisible()
  })

  test("a lost acknowledgement followed by another tab's save is still confirmed; queued edits then meet the conflict", async () => {
    const { server } = await renderAgents()
    server.deliver('lost-after-commit')
    toggleTags()
    await wait(600)
    server.otherTab({ new_batch_instructions: 'From the other tab' })
    // Queued while the outcome is unknown, over revision 7.
    moreSessions()
    await wait(1000)
    expect(screen.getByText('Tag suggestions: Saved')).toBeVisible()
    expect(server.sent()[1].save_id).toBe(server.sent()[0].save_id)
    // A newer read from another tab confirms nothing queued.
    expect(server.sent()[2]).toMatchObject({ expected_revision: '7', session_concurrency: 4 })
    expect(within(heading('Sessions')).getByRole('alert')).toHaveTextContent(
      'Not saved: changed in another tab',
    )
  })
})

describe("a change that can't be confirmed", () => {
  async function unresolved(server: AgentSettingsServer) {
    server.deliver('lost-after-commit')
    toggleTags()
    await wait(600)
    server.prune()
    server.otherTab({ new_batch_instructions: 'From the other tab' })
    server.prune()
    await wait(1000)
  }

  test('offers Reload only, resends nothing, and Reload discards it and later queued edits', async () => {
    const { server, dirty } = await renderAgents()
    await unresolved(server)
    const status = within(heading('Tag suggestions')).getByRole('alert')
    expect(status).toHaveTextContent('Tag suggestions: Couldn’t confirm this change')
    expect(
      within(status)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Reload'])
    const sent = server.sent().length
    // A later edit in the same subsection is queued, not sent.
    toggleTags()
    toggleTags()
    await wait(10000)
    expect(server.sent()).toHaveLength(sent)
    expect(dirty()).toBe(true)

    fireEvent.click(within(status).getByRole('button', { name: /Reload/ }))
    await wait(1000)
    expect(server.sent()).toHaveLength(sent)
    expect(screen.getByRole('switch', { name: 'Suggest tags for new batches' })).toBeChecked()
    expect(screen.queryByText(/Couldn’t confirm/)).not.toBeInTheDocument()
    expect(dirty()).toBe(false)
  })

  test('Reload keeps text drafts elsewhere, which still hold the guard', async () => {
    const { server, dirty } = await renderAgents()
    const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
    fireEvent.change(instructions, { target: { value: 'Draft kept through Reload' } })
    await unresolved(server)
    fireEvent.click(within(heading('Tag suggestions')).getByRole('button', { name: /Reload/ }))
    await wait()
    expect(instructions).toHaveValue('Draft kept through Reload')
    expect(dirty()).toBe(true)
  })

  test('a replay confirms its save, and a newer read from another tab leaves queued edits on the conflict path', async () => {
    const { server } = await renderAgents()
    server.deliver('lost-after-commit')
    fireEvent.click(screen.getByRole('switch', { name: 'Allow public web pages' }))
    await wait(600)
    server.otherTab({ new_batch_instructions: 'From the other tab' })
    toggleTags()
    await wait(1000)
    expect(screen.getByText('Web research: Saved')).toBeVisible()
    expect(server.sent().at(-1)).toMatchObject({ expected_revision: '7' })
    expect(within(heading('Tag suggestions')).getByRole('alert')).toHaveTextContent(
      'changed in another tab',
    )
  })
})

describe('providers', () => {
  test('turning a provider off saves at once with its steps reset, superseding a queued step choice', async () => {
    const { server } = await renderAgents(bothOn)
    const research = within(screen.getByRole('group', { name: 'Research' }))
    pick(stepPicker('Research'), 'Codex · gpt-6-luna')
    await wait(200)
    fireEvent.click(providerSwitch('Codex'))
    await wait(0)
    expect(server.sent()).toHaveLength(1)
    expect(server.sent()[0]).toMatchObject({
      providers: { codex: { enabled: false } },
      default_provider: 'claude',
      stage_selections: {},
    })
    await wait(1000)
    expect(server.sent()).toHaveLength(1)
    expect(research.getByText('Default · Claude opus')).toBeVisible()
    expect(research.getByText(/now uses Default/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-disabled', 'true')
  })

  test('turning off the default provider moves the default and resets its saved steps, together', async () => {
    const { server } = await renderAgents(
      agentSettings('7', claude, {
        ...bothOn,
        stage_selections: { images: { provider: 'claude', model: 'opus' } },
      }),
    )
    fireEvent.click(providerSwitch('Claude'))
    await wait(0)
    expect(server.sent()[0]).toMatchObject({
      providers: { claude: { enabled: false }, codex: { enabled: true } },
      default_provider: 'codex',
      stage_selections: {},
    })
    expect(
      within(screen.getByRole('group', { name: 'Images' })).getByText(/now uses Default/),
    ).toBeVisible()
  })

  test('the last provider on is refused at its switch and nothing is sent', async () => {
    const { server, dirty } = await renderAgents()
    fireEvent.click(providerSwitch('Claude'))
    expect(providerSwitch('Claude')).toBeChecked()
    expect(
      within(screen.getByRole('group', { name: 'Claude' })).getByRole('alert'),
    ).toHaveTextContent('At least one provider stays on')
    await wait(2000)
    expect(server.sent()).toHaveLength(0)
    expect(dirty()).toBe(false)
  })

  test('a step choice queued for a provider turned off elsewhere is dropped when Try again validates it', async () => {
    const { server } = await renderAgents(bothOn)
    server.otherTab({
      providers: { ...bothOn.providers, codex: { ...bothOn.providers.codex, enabled: false } },
    })
    pick(stepPicker('Research'), 'Codex · gpt-6.1-sol')
    await wait(600)
    fireEvent.click(
      within(heading('Provider and model per step')).getByRole('button', {
        name: 'Try the same save again',
      }),
    )
    await wait()
    // Validated over the new revision: the choice names a provider that is now off.
    expect(server.sent()).toHaveLength(1)
    expect(server.saved.stage_selections).toEqual({})
    expect(
      within(screen.getByRole('group', { name: 'Research' })).getByText(/now uses Default/),
    ).toBeVisible()
  })
})

describe('round 1 regressions', () => {
  test('Try again after another tab turned the other provider off keeps this one on', async () => {
    const { server } = await renderAgents(bothOn)
    server.otherTab({
      providers: { ...bothOn.providers, claude: { ...bothOn.providers.claude, enabled: false } },
      default_provider: 'codex',
    })
    fireEvent.click(providerSwitch('Codex'))
    await wait(0)
    fireEvent.click(
      within(heading('Providers')).getByRole('button', { name: 'Try the same save again' }),
    )
    await wait()
    expect(server.sent()).toHaveLength(1)
    expect(server.saved.providers.codex.enabled).toBe(true)
    expect(providerSwitch('Codex')).toBeChecked()
    expect(
      within(screen.getByRole('group', { name: 'Codex' })).getByRole('alert'),
    ).toHaveTextContent('At least one provider stays on')
  })

  test('a replay whose read fails stays confirmed: only the read is retried, never the save', async () => {
    const { server } = await renderAgents()
    server.deliver('lost-after-commit')
    toggleTags()
    await wait(600)
    server.client.settings.mockRejectedValueOnce(new TypeError('network_failed'))
    await wait(1000)
    const sent = server.sent().length
    server.prune()
    await wait(2000)
    expect(server.sent()).toHaveLength(sent)
    expect(screen.getByText('Tag suggestions: Saved')).toBeVisible()
    expect(screen.queryByText(/Couldn’t confirm/)).not.toBeInTheDocument()
  })

  test('a save that fails before it is sent offers Try again, which sends it and frees the queue', async () => {
    const { server } = await renderAgents()
    vi.spyOn(crypto, 'randomUUID').mockImplementationOnce(() => {
      throw new Error('no_entropy')
    })
    toggleTags()
    await wait(600)
    expect(server.sent()).toHaveLength(0)
    moreSessions()
    await wait(600)
    expect(server.sent()).toHaveLength(0)
    fireEvent.click(
      within(heading('Tag suggestions')).getByRole('button', { name: 'Try the same save again' }),
    )
    await wait()
    expect(server.sent().map((request) => request.auto_tags_default)).toEqual([true, true])
    expect(server.saved).toMatchObject({ auto_tags_default: true, session_concurrency: 4 })
  })
})

describe('round 2 regressions', () => {
  test("a retried sign-in never writes back a step's provider that another tab changed", async () => {
    const { server } = await renderAgents({
      ...bothOn,
      stage_selections: { research: { provider: 'claude', model: 'opus' } },
    })
    server.otherTab({ stage_selections: { research: { provider: 'codex', model: 'gpt-6-luna' } } })
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Claude' })).getByRole('button', {
        name: 'API key',
      }),
    )
    await wait(600)
    fireEvent.click(
      within(heading('Providers')).getByRole('button', { name: 'Try the same save again' }),
    )
    await wait()
    expect(server.saved.providers.claude.authentication).toBe('api_key')
    expect(server.saved.stage_selections).toEqual({
      research: { provider: 'codex', model: 'gpt-6-luna' },
    })
  })

  test('a confirmed save whose read answers after the page is left reports nothing', async () => {
    const { server, reports, unmount } = await renderAgents()
    server.deliver('lost-after-commit')
    toggleTags()
    await wait(600)

    let answer: (settings: AgentSettingsDto) => void = () => {}

    server.client.settings.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    )
    // The resend's receipt confirms it; its first read is still out when the page is left.
    await wait(1000)
    expect(within(heading('Tag suggestions')).getByRole('status')).toHaveTextContent('Reloading…')
    unmount()
    const before = reports.length
    answer(server.saved)
    await wait(10000)
    expect(reports).toHaveLength(before)
  })

  test('a provider with no saved model ID is refused at its switch and stays off', async () => {
    const { server } = await renderAgents(
      agentSettings('7', claude, {
        providers: {
          claude: { enabled: true, authentication: 'subscription', default_model: 'opus' },
          codex: { enabled: false, authentication: 'subscription', default_model: '' },
        },
      }),
    )
    fireEvent.click(providerSwitch('Codex'))
    expect(providerSwitch('Codex')).not.toBeChecked()
    expect(
      within(screen.getByRole('group', { name: 'Codex' })).getByRole('alert'),
    ).toHaveTextContent('Choose a default model before turning Codex on')
    await wait(2000)
    expect(server.sent()).toHaveLength(0)
  })

  test("a failed Reload keeps a change that can't be confirmed as it was", async () => {
    const { server } = await renderAgents()
    server.deliver('lost-after-commit')
    toggleTags()
    await wait(600)
    server.prune()
    server.otherTab({ new_batch_instructions: 'From the other tab' })
    server.prune()
    await wait(1000)
    server.client.settings.mockRejectedValueOnce(new TypeError('network_failed'))
    fireEvent.click(within(heading('Tag suggestions')).getByRole('button', { name: /Reload/ }))
    await wait()
    expect(within(heading('Tag suggestions')).getByRole('alert')).toHaveTextContent(
      'Couldn’t confirm this change',
    )
  })
})

describe('text keeps an explicit Save', () => {
  test('Instructions show Save and Discard only while edited, and save nothing until Save', async () => {
    const { server } = await renderAgents()
    const card = within(heading('Instructions'))
    expect(card.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    fireEvent.change(card.getByRole('textbox'), { target: { value: 'Count reels by label.' } })
    expect(card.getByRole('button', { name: 'Save' })).toBeVisible()
    expect(card.getByRole('button', { name: 'Discard my edit' })).toBeVisible()
    toggleTags()
    await wait(2000)
    expect(server.sent()).toHaveLength(1)
    expect(server.sent()[0].new_batch_instructions).toBe('')
    fireEvent.click(card.getByRole('button', { name: 'Save' }))
    await wait()
    expect(server.saved.new_batch_instructions).toBe('Count reels by label.')
    expect(card.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})

describe('leaving', () => {
  test('leaving sends a pending save at once and continues once it is confirmed', async () => {
    const { server, reports } = await renderAgents()
    toggleTags()
    await wait(200)
    const beforeLeave = reports.at(-1)?.beforeLeave
    expect(reports.at(-1)?.dirty).toBe(true)
    let left: boolean | undefined
    void beforeLeave!().then((ok) => {
      left = ok
    })
    await wait()
    expect(server.sent()).toHaveLength(1)
    expect(left).toBe(true)
    expect(reports.at(-1)?.dirty).toBe(false)
  })

  test('leaving stays when the save fails, with the failure and Try again shown', async () => {
    const { server, reports } = await renderAgents()
    server.otherTab({ session_concurrency: 6 })
    toggleTags()
    let left: boolean | undefined
    void reports.at(-1)!.beforeLeave!().then((ok) => {
      left = ok
    })
    await wait()
    expect(left).toBe(false)
    expect(
      within(heading('Tag suggestions')).getByRole('button', { name: 'Try the same save again' }),
    ).toBeVisible()
  })

  test('a text draft still keeps the page from being left', async () => {
    const { reports } = await renderAgents()
    fireEvent.change(screen.getByRole('textbox', { name: 'Instructions for every new batch' }), {
      target: { value: 'Unsaved' },
    })
    let left: boolean | undefined
    void reports.at(-1)!.beforeLeave!().then((ok) => {
      left = ok
    })
    await wait()
    expect(left).toBe(false)
  })
})

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
})

import { operatorReviewClient } from '@invimport/contracts/client'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey } from '#/queries/scope'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { render, fixtureScope } from '#/test/render'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import type { MediaClient } from '#/media/types'
import type { SettingsPorts } from '#/capture/types'
import { CaptureWorkspace } from './CaptureWorkspace'
import { ApiClientsProvider } from '#/components/clients/ApiClientsProvider'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: '30000000-0000-4000-8000-000000000003',
  target_context_id: '40000000-0000-4000-8000-000000000004',
  title: 'Media draft boundary',
  revision: '1',
  updated_at: '2026-11-02T00:00:00Z',
  archived: false,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '50000000-0000-4000-8000-000000000005', sequence: '0' },
}
const snapshot: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '0',
  evidence: [],
  attachments: [],
  groups: [],
  derivations: [],
}

function ports(overrides: Partial<SettingsPorts> = {}): SettingsPorts {
  return {
    connected: true,
    save: vi.fn(() => new Promise<CaptureSnapshotDto>(() => undefined)),
    accept: vi.fn(),
    read: vi.fn(async () => batch),
    ...overrides,
  }
}

function mediaClient(): MediaClient {
  return {
    snapshot: vi.fn(async () => snapshot),
    edit: vi.fn(async () => snapshot),
    upload: vi.fn(async () => {
      throw new Error('not submitted')
    }),
  }
}

afterEach(() => {
  history.replaceState(null, '', location.pathname)
})

test('a pending original pauses settings and keeps its request when Capture rerenders', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  const media = mediaClient()
  const dirty = vi.fn()
  const settings = ports()
  const props = {
    batch,
    busy: false,
    edit,
    observe: vi.fn(async () => null),
    onDirtyChange: dirty,
    settings,
  }
  const view = render(<CaptureWorkspace {...props} />, { clients: { media } })
  const input = await screen.findByLabelText('Choose photos')
  const file = new File(['original bytes'], 'bench-photo.png', { type: 'image/png' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.upload(input, file)

  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  expect(screen.getByText(/Finish or discard the evidence change/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Write a note' })).toBeDisabled()
  view.rerender(
    <CaptureWorkspace {...props} batch={{ ...batch, updated_at: '2026-11-02T00:01:00Z' }} />,
  )
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  // Batch rebuilds its ports on every render; that must not clear the pending original.
  view.rerender(<CaptureWorkspace {...props} settings={ports({ read: settings.read })} />)
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Write a note' })).toBeDisabled()
  view.rerender(<CaptureWorkspace {...props} />)
  expect(settings.save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Retain bench-photo.png' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: 'Retain bench-photo.png' }))
  await screen.findByRole('alert')
  const firstRequest = vi.mocked(media.upload).mock.calls[0]
  await user.click(screen.getByRole('button', { name: 'Retain bench-photo.png' }))
  await waitFor(() => expect(media.upload).toHaveBeenCalledTimes(2))
  expect(vi.mocked(media.upload).mock.calls[1]).toEqual(firstRequest)
  expect(firstRequest[3]).toBe(file)

  await user.click(screen.getByRole('button', { name: 'Discard selected file' }))
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(screen.getByLabelText('Batch title')).toBeEnabled()
  expect(settings.read).toHaveBeenCalled()
})

test('unacknowledged settings freeze file selection until their save is acknowledged', async () => {
  const user = userEvent.setup()

  let acknowledge = () => undefined as void

  const settings = ports({
    save: vi.fn(
      (change) =>
        new Promise<CaptureSnapshotDto>((resolve) => {
          acknowledge = () => resolve({ ...batch, title: change.title, revision: '2' })
        }),
    ),
  })
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => undefined)}
        observe={vi.fn(async () => null)}
        settings={settings}
      />
    </ApiClientsProvider>,
  )
  const upload = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(upload).toBeEnabled())
  await user.type(screen.getByRole('textbox', { name: 'Batch title' }), ' updated')
  expect(upload).toBeDisabled()
  await waitFor(() => expect(settings.save).toHaveBeenCalledOnce())
  expect(upload).toBeDisabled()
  await act(async () => acknowledge())
  await waitFor(() => expect(upload).toBeEnabled())
})

test('batch instructions cannot replace the active media query during a live invalidation', async () => {
  const cache = createServerQueryClient()
  const media = mediaClient()
  const operator = operatorReviewClient(fixtureScope.origin, 'a'.repeat(64), async () => {
    throw new Error('unexpected_instruction_request')
  })
  render(
    <ServerStateProvider scope={fixtureScope} client={cache}>
      <ApiClientsProvider value={{ media, operator }}>
        <CaptureWorkspace
          batch={batch}
          busy={false}
          edit={vi.fn()}
          observe={vi.fn()}
          operatorReview={{
            batch_id: batch.id,
            revision: batch.revision,
            lots: [],
            retired_lots: [],
            instructions: [],
            cursor: batch.cursor,
          }}
          reload={vi.fn()}
          settings={ports({ instruct: vi.fn(() => new Promise<never>(() => undefined)) })}
        />
      </ApiClientsProvider>
    </ServerStateProvider>,
  )
  await waitFor(() => expect(screen.getByLabelText('Choose photos')).toBeEnabled())
  const note = screen.getByLabelText('Custom instructions')
  await userEvent.setup().type(note, 'Preserve this instruction draft.')
  await act(async () => {
    await cache.invalidateQueries({ queryKey: serverQueryKey(fixtureScope, 'media', batch.id) })
  })
  expect(media.snapshot).toHaveBeenCalledTimes(2)
  expect(cache.getQueryState(serverQueryKey(fixtureScope, 'media', batch.id))?.status).toBe(
    'success',
  )
  expect(note).toHaveValue('Preserve this instruction draft.')
})

test('an unsaved evidence note freezes media editing until it is saved or discarded', async () => {
  const user = userEvent.setup()
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  const input = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(input).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Write a note' }))
  await user.type(screen.getByRole('textbox', { name: 'Evidence note' }), 'Opened packet')
  expect(input).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Discard note' }))
  await waitFor(() => expect(input).toBeEnabled())
})

test('settings stay paused until the revision after an evidence change is adopted', async () => {
  const user = userEvent.setup()
  let respond: { resolve: (value: CaptureSnapshotDto) => void; reject: (error: unknown) => void }
  const read = vi.fn(
    () =>
      new Promise<CaptureSnapshotDto>((resolve, reject) => {
        respond = { resolve, reject }
      }),
  )
  const settings = ports({ read })
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        settings={settings}
      />
    </ApiClientsProvider>,
  )
  const input = await screen.findByLabelText('Choose photos')
  await waitFor(() => expect(input).toBeEnabled())
  await user.upload(input, new File(['x'], 'a.png', { type: 'image/png' }))
  await user.click(screen.getByRole('button', { name: 'Discard selected file' }))
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  await act(async () => respond.reject(new TypeError('offline')))
  expect(await screen.findByText(/could not be refreshed after the evidence change/)).toBeVisible()
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Refresh saved settings' }))
  await act(async () => respond.resolve({ ...batch, revision: '2' }))
  expect(settings.accept).toHaveBeenCalledWith({ ...batch, revision: '2' })
  await waitFor(() => expect(screen.getByLabelText('Batch title')).toBeEnabled())
})

for (const order of ['older first', 'newer first'] as const) {
  test(`only the newest post-evidence refresh releases settings (${order})`, async () => {
    const user = userEvent.setup()
    const reads: ((value: CaptureSnapshotDto) => void)[] = []
    const read = vi.fn(() => new Promise<CaptureSnapshotDto>((resolve) => reads.push(resolve)))
    const settings = ports({ read })
    render(
      <ApiClientsProvider value={{ media: mediaClient() }}>
        <CaptureWorkspace
          batch={batch}
          busy={false}
          edit={vi.fn(async () => true)}
          observe={vi.fn(async () => null)}
          onDirtyChange={vi.fn()}
          settings={settings}
        />
      </ApiClientsProvider>,
    )
    const input = await screen.findByLabelText('Choose photos')
    await waitFor(() => expect(input).toBeEnabled())
    for (const name of ['a.png', 'b.png']) {
      await user.upload(input, new File(['x'], name, { type: 'image/png' }))
      await user.click(screen.getByRole('button', { name: 'Discard selected file' }))
    }
    expect(reads).toHaveLength(2)
    const older = { ...batch, revision: '2' }
    const newer = { ...batch, revision: '3' }
    if (order === 'older first') {
      await act(async () => reads[0](older))
      expect(screen.getByLabelText('Batch title')).toBeDisabled()
      await act(async () => reads[1](newer))
    } else {
      await act(async () => reads[1](newer))
      await act(async () => reads[0](older))
    }
    expect(settings.accept).toHaveBeenCalledTimes(1)
    expect(settings.accept).toHaveBeenCalledWith(newer)
    await waitFor(() => expect(screen.getByLabelText('Batch title')).toBeEnabled())
  })
}

test('an evidence group location is saved through the capture command', async () => {
  const user = userEvent.setup()
  const groupId = '70000000-0000-4000-8000-000000000007'
  const media = mediaClient()
  vi.mocked(media.snapshot).mockResolvedValue({
    ...snapshot,
    groups: [{ id: groupId, label: 'Bag X' }],
  } as MediaSnapshotDto)
  const edit = vi.fn(async () => true)
  render(
    <ApiClientsProvider value={{ media }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={edit}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  const field = await screen.findByLabelText('Location for group Bag X')
  await waitFor(() => expect(field).toBeEnabled())
  await user.selectOptions(field, 'clear')
  expect(edit).toHaveBeenCalledWith({
    kind: 'group_location',
    group_id: groupId,
    location: { mode: 'clear' },
  })
})

test('an unconfirmed group location stays chosen and dirty until retried or discarded', async () => {
  const user = userEvent.setup()
  const groupId = '70000000-0000-4000-8000-000000000007'
  const media = mediaClient()
  vi.mocked(media.snapshot).mockResolvedValue({
    ...snapshot,
    groups: [{ id: groupId, label: 'Bag X' }],
  } as MediaSnapshotDto)
  const edit = vi.fn(async () => false)
  const dirty = vi.fn()
  render(
    <ApiClientsProvider value={{ media }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={edit}
        observe={vi.fn(async () => null)}
        onDirtyChange={dirty}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  const field = await screen.findByLabelText('Location for group Bag X')
  await waitFor(() => expect(field).toBeEnabled())
  await user.selectOptions(field, 'clear')
  await screen.findByText(/group location was not confirmed/)
  expect(field).toHaveValue('clear')
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  edit.mockResolvedValue(true as never)
  await user.click(screen.getByRole('button', { name: 'Retry group location' }))
  expect(edit).toHaveBeenLastCalledWith({
    kind: 'group_location',
    group_id: groupId,
    location: { mode: 'clear' },
  })
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false))
})

test('discarding an unconfirmed group location reloads through the owner and keeps protection until it succeeds', async () => {
  const user = userEvent.setup()
  const groupId = '70000000-0000-4000-8000-000000000007'
  const media = mediaClient()
  vi.mocked(media.snapshot).mockResolvedValue({
    ...snapshot,
    groups: [{ id: groupId, label: 'Bag X' }],
  } as MediaSnapshotDto)

  let finish = () => undefined as void

  const reload = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
  const dirty = vi.fn()
  render(
    <ApiClientsProvider value={{ media }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => false)}
        observe={vi.fn(async () => null)}
        onDirtyChange={dirty}
        reload={reload}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  const field = await screen.findByLabelText('Location for group Bag X')
  await waitFor(() => expect(field).toBeEnabled())
  await user.selectOptions(field, 'clear')
  await user.click(await screen.findByRole('button', { name: 'Discard group location change' }))
  expect(reload).toHaveBeenCalledOnce()
  expect(dirty).toHaveBeenLastCalledWith(true)
  await act(async () => finish())
  // Still mounted means the owner did not reload; the change and its protection remain.
  expect(await screen.findByText(/Saved values could not be reloaded/)).toBeVisible()
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(field).toHaveValue('clear')
})

test('batch notes sit in the evidence card', async () => {
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => undefined)}
        observe={vi.fn(async () => null)}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  const evidence = await screen.findByRole('region', { name: 'Evidence' })
  expect(within(evidence).getByRole('textbox', { name: 'Notes for the whole batch' })).toBeVisible()
})

test('at phone width the glance follows the capture tiles and settings collapse to a summary', async () => {
  const user = userEvent.setup()
  // jsdom has no matchMedia; this one reports every width query as matching.
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  )
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => undefined)}
        observe={vi.fn(async () => null)}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  const evidence = await screen.findByRole('region', { name: 'Evidence' })
  const glance = within(evidence).getByRole('region', { name: /Proposed lots/ })
  const tiles = within(evidence).getByRole('button', { name: 'Take photos' })
  expect(tiles.compareDocumentPosition(glance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getAllByRole('region', { name: /Proposed lots/ })).toHaveLength(1)

  const toggle = screen.getByRole('button', { name: /^Batch settings/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByLabelText('Batch title')).not.toBeVisible()
  await user.click(toggle)
  expect(screen.getByLabelText('Batch title')).toBeVisible()
  delete (window as { matchMedia?: unknown }).matchMedia
})

test('settings stay open when the phone fold arrives while a field is being edited', () => {
  let phone = false
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        get matches() {
          return phone && query.includes('max-width')
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList,
  )
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => undefined)}
        observe={vi.fn(async () => null)}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  screen.getByLabelText('Batch title').focus()
  act(() => {
    phone = true
    listeners.forEach((listener) => listener())
  })
  expect(screen.getByRole('button', { name: /^Batch settings/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getByLabelText('Batch title')).toBeVisible()
  delete (window as { matchMedia?: unknown }).matchMedia
})

test('focus in the lots glance survives crossing the phone breakpoint', () => {
  let phone = false
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        get matches() {
          return phone && query.includes('max-width')
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList,
  )
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => undefined)}
        observe={vi.fn(async () => null)}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  const map = screen.getByRole('link', { name: 'See the map in Review' })
  map.focus()
  act(() => {
    phone = true
    listeners.forEach((listener) => listener())
  })
  expect(document.activeElement).toHaveAttribute('href', map.getAttribute('href'))
  delete (window as { matchMedia?: unknown }).matchMedia
})

test('focus on the settings fold moves to the heading when the phone layout ends', () => {
  let phone = true
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        get matches() {
          return phone && query.includes('max-width')
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList,
  )
  render(
    <ApiClientsProvider value={{ media: mediaClient() }}>
      <CaptureWorkspace
        batch={batch}
        busy={false}
        edit={vi.fn(async () => undefined)}
        observe={vi.fn(async () => null)}
        settings={ports()}
      />
    </ApiClientsProvider>,
  )
  screen.getByRole('button', { name: /^Batch settings/ }).focus()
  act(() => {
    phone = false
    listeners.forEach((listener) => listener())
  })
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Batch settings' }))
  delete (window as { matchMedia?: unknown }).matchMedia
})

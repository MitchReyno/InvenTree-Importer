import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { IntakeRequestError } from '@invimport/contracts/client'
import type { BatchDefaultsDto, CatalogueModelDto, CatalogueRecordDto } from '@invimport/contracts'
import { fixtureScope, render } from '#/test/render'
import type { BatchDefaultsClient, CatalogueClient } from '#/catalogue/types'
import { BatchDefaultsSection } from './BatchDefaultsSection'
import { BatchDefaultsForm } from './BatchDefaultsForm'

const records: Record<CatalogueModelDto, CatalogueRecordDto[]> = {
  location: [
    {
      kind: 'location',
      pk: '11',
      name: 'Drawer 4',
      description: '',
      path: 'Bench/Drawer 4',
      parent_pk: null,
      structural: false,
    },
    {
      kind: 'location',
      pk: '12',
      name: 'Drawer 5',
      description: '',
      path: 'Bench/Drawer 5',
      parent_pk: null,
      structural: false,
    },
  ],
  supplier: [
    { kind: 'supplier', pk: '7', name: 'Mouser Electronics', description: '', manufacturer: false },
  ],
}

const saved: BatchDefaultsDto = {
  revision: '3',
  location: { pk: '11', label: 'Drawer 4', status: 'found' },
  supplier: { pk: '9', label: null, status: 'not_found' },
}

function clients() {
  const catalogue = {
    candidatesAll: vi.fn(async (model: CatalogueModelDto) => ({
      model,
      target_context_id: fixtureScope.targetContextId,
      candidates: records[model],
      coverage: { loaded: records[model].length, total: records[model].length, truncated: false },
    })),
    searchAll: vi.fn(async (model: CatalogueModelDto, query: string) => ({
      model,
      target_context_id: fixtureScope.targetContextId,
      query,
      results: records[model].filter((record) => record.name.includes(query)),
      coverage: { loaded: 0, total: 0, truncated: false },
      exact_id: { status: 'not_requested' as const },
    })),
  } as unknown as CatalogueClient
  const batchDefaults = {
    read: vi.fn(async () => saved),
    save: vi.fn(
      async (input: { location_pk: string | null; supplier_pk: string | null }) =>
        ({
          revision: '4',
          location: input.location_pk
            ? {
                pk: input.location_pk,
                label: records.location.find((r) => r.pk === input.location_pk)!.name,
                status: 'found',
              }
            : null,
          supplier: input.supplier_pk
            ? { pk: input.supplier_pk, label: 'Mouser Electronics', status: 'found' }
            : null,
        }) as BatchDefaultsDto,
    ),
  }
  return { catalogue, batchDefaults }
}

async function renderDefaults(api = clients(), dirty = vi.fn()) {
  render(<BatchDefaultsSection onDirtyChange={dirty} />, {
    clients: {
      catalogue: api.catalogue,
      batchDefaults: api.batchDefaults as unknown as BatchDefaultsClient,
    },
  })
  await screen.findByRole('combobox', { name: 'Default location' })
  return api
}

test('a saved default deleted in InvenTree says so, and a new pick saves under the revision', async () => {
  const user = userEvent.setup()
  const dirty = vi.fn()
  const api = await renderDefaults(clients(), dirty)
  expect(screen.getByText(/supplier wasn't found in InvenTree/)).toBeVisible()
  await user.type(screen.getByRole('combobox', { name: 'Default location' }), 'Drawer 5')
  await user.click(await screen.findByRole('option', { name: /Drawer 5/ }))
  expect(dirty).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'No supplier' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.batchDefaults.save).toHaveBeenCalledWith({
      expected_revision: '3',
      location_pk: '12',
      supplier_pk: null,
    }),
  )
  expect(await screen.findByText(/Batches created from now on start with these/)).toBeVisible()
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('a stale save is a conflict that keeps the pick and offers Reload', async () => {
  const user = userEvent.setup()
  const api = clients()
  api.batchDefaults.save.mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  await renderDefaults(api)
  await user.click(screen.getByRole('button', { name: 'No default location' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/changed in another tab/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'No default location' })).toBeNull()
  api.batchDefaults.read.mockResolvedValueOnce({ ...saved, revision: '5' })
  await user.click(screen.getByRole('button', { name: 'Reload' }))
  expect(await screen.findByRole('button', { name: 'No default location' })).toBeVisible()
})

test('a record that is no longer in InvenTree is refused with a way forward', async () => {
  const user = userEvent.setup()
  const api = clients()
  api.batchDefaults.save.mockRejectedValue(new IntakeRequestError(422, 'batch_default_not_found'))
  await renderDefaults(api)
  await user.type(screen.getByRole('combobox', { name: 'Default location' }), 'Drawer 5')
  await user.click(await screen.findByRole('option', { name: /Drawer 5/ }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/isn't in InvenTree any more/)).toBeVisible()
  expect(api.batchDefaults.save).toHaveBeenCalledTimes(1)
  // The pick is kept for another try.
  expect(screen.getAllByText(/Drawer 5/).length).toBeGreaterThan(0)
})

test('while a save is pending a default cannot be cleared, and a second Save sends nothing', async () => {
  const user = userEvent.setup()
  const api = clients()

  let finish: (value: BatchDefaultsDto) => void = () => undefined

  api.batchDefaults.save.mockImplementation(
    () => new Promise<BatchDefaultsDto>((resolve) => (finish = resolve)),
  )
  await renderDefaults(api)
  await user.click(screen.getByRole('button', { name: 'No supplier' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('button', { name: 'No default location' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Saving…' }))
  expect(api.batchDefaults.save).toHaveBeenCalledTimes(1)
  finish({ ...saved, revision: '4', supplier: null })
  expect(await screen.findByText(/Batches created from now on/)).toBeVisible()
})

test('until the first edit the form shows the newest load, and an edit sends its revision', async () => {
  const user = userEvent.setup()
  const api = clients()
  const props = {
    client: api.batchDefaults as unknown as BatchDefaultsClient,
    onLoaded: vi.fn(),
    onDirtyChange: vi.fn(),
  }
  const view = render(<BatchDefaultsForm {...props} loaded={saved} />, {
    clients: { catalogue: api.catalogue },
  })
  const newer: BatchDefaultsDto = {
    revision: '5',
    location: { pk: '11', label: 'Drawer 4', status: 'found' },
    supplier: { pk: '7', label: 'Mouser Electronics', status: 'found' },
  }
  view.rerender(<BatchDefaultsForm {...props} loaded={newer} />)
  expect(await screen.findByText(/Mouser Electronics/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'No default location' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.batchDefaults.save).toHaveBeenCalledWith({
      expected_revision: '5',
      location_pk: null,
      supplier_pk: '7',
    }),
  )
})

test('an unconfirmed save and a failed Reload both keep Reload and the choice', async () => {
  const user = userEvent.setup()
  const api = clients()
  api.batchDefaults.save.mockRejectedValue(new Error('offline'))
  await renderDefaults(api)
  await user.click(screen.getByRole('button', { name: 'No supplier' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/wasn’t confirmed/)).toBeVisible()
  api.batchDefaults.read.mockRejectedValueOnce(new Error('offline'))
  await user.click(screen.getByRole('button', { name: 'Reload' }))
  expect(await screen.findByText(/couldn’t be loaded/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'No supplier' })).toBeNull()
})

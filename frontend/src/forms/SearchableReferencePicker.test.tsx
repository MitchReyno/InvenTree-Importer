import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, test, vi } from 'vitest'
import type { CatalogueRecordDto } from '@invimport/contracts'
import { SearchableReferencePicker, type PickerSearch } from './SearchableReferencePicker'

const supplier = (pk: string, name: string): CatalogueRecordDto => ({
  kind: 'supplier',
  pk,
  name,
  description: '',
  manufacturer: false,
})

const location = (pk: string, name: string, path: string): CatalogueRecordDto => ({
  kind: 'location',
  pk,
  name,
  description: '',
  path,
  parent_pk: null,
  structural: false,
})

const suppliers = [supplier('7', 'Mouser Electronics'), supplier('8', 'Digi-Key')]
const locations = [
  location('41', 'Incoming inspection drawer', 'Bench/Incoming inspection drawer'),
  location('42', 'Incoming inspection drawer', 'Store/Incoming inspection drawer'),
]

const complete = (records: CatalogueRecordDto[]) => ({
  loaded: records.length,
  total: records.length,
  truncated: false,
})

const noSearch: PickerSearch = async () => ({ results: [], exact: null })

function picker(props: Partial<Parameters<typeof SearchableReferencePicker>[0]> = {}) {
  const onChange = vi.fn()
  const view = render(
    <StrictMode>
      <SearchableReferencePicker
        label="Supplier"
        value={null}
        candidates={suppliers}
        coverage={complete(suppliers)}
        status="ready"
        search={noSearch}
        onChange={onChange}
        {...props}
      />
    </StrictMode>,
  )
  return {
    onChange,
    view,
    input: screen.getByRole('combobox', { name: props.label ?? 'Supplier', hidden: true }),
  }
}

test('a typo suggests the original record without selecting it, then keyboard selects it', async () => {
  const user = userEvent.setup()
  const { onChange, input } = picker()
  await user.type(input, 'Mousr')
  expect(await screen.findByRole('option', { name: /Mouser Electronics · #7/ })).toBeVisible()
  expect(onChange).not.toHaveBeenCalled()
  await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith(suppliers[0])
})

test('Escape dismisses suggestions without changing the selection', async () => {
  const user = userEvent.setup()
  const { onChange, input } = picker({ value: { pk: '8', label: 'Digi-Key' } })
  await user.type(input, 'Mou')
  expect(await screen.findByRole('listbox')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByText('Digi-Key · #8')).toBeVisible()
  expect(input).toHaveFocus()
})

test('similar location names stay distinguishable by path and exact ID', async () => {
  const user = userEvent.setup()
  const { input } = picker({
    label: 'Default location',
    candidates: locations,
    coverage: complete(locations),
  })
  await user.type(input, 'Incomming')
  const options = await screen.findAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining('#41 · Bench/Incoming inspection drawer'),
    expect.stringContaining('#42 · Store/Incoming inspection drawer'),
  ])
})

test('an older search response cannot replace newer results', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const pending = new Map<string, (records: CatalogueRecordDto[]) => void>()

    const search: PickerSearch = (q) =>
      new Promise((resolve) => pending.set(q, (results) => resolve({ results, exact: null })))

    const { input } = picker({ candidates: [], coverage: complete([]), search })
    await user.type(input, 'Far')
    await act(() => vi.advanceTimersByTimeAsync(300))
    await user.type(input, 'nell')
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(async () => pending.get('Farnell')!([supplier('9', 'Farnell')]))
    await act(async () => pending.get('Far')!([supplier('10', 'Far East Parts')]))
    expect(screen.getByRole('option', { name: /Farnell · #9/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Far East Parts/ })).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('a newer query aborts the search it replaces', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const signals = new Map<string, AbortSignal>()

    const search: PickerSearch = (q, signal) => {
      signals.set(q, signal)
      return new Promise(() => {})
    }

    const { input } = picker({ candidates: [], coverage: complete([]), search })
    await user.type(input, 'Far')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(signals.get('Far')!.aborted).toBe(false)
    await user.type(input, 'nell')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(signals.get('Far')!.aborted).toBe(true)
    expect(signals.get('Farnell')!.aborted).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

test('a numeric ID offers the exact detail read first without fuzzy substitution', async () => {
  const user = userEvent.setup()
  const exact = supplier('1234', 'Rare Parts Ltd')

  const search: PickerSearch = async () => ({ results: [], exact })

  const { input } = picker({ search })
  await user.type(input, '1234')
  const options = await screen.findAllByRole('option')
  expect(options).toHaveLength(1)
  expect(options[0]).toHaveTextContent('Rare Parts Ltd · #1234 · Exact ID')
})

test('partial coverage is disclosed and an empty result is not reported as absence', async () => {
  const user = userEvent.setup()
  const { input } = picker({ coverage: { loaded: 500, total: 1240, truncated: true } })
  expect(screen.getByText(/Suggestions use 500 of 1,240 suppliers/)).toBeVisible()
  await user.type(input, 'Oscilloscope')
  expect(await screen.findByText('No matches in the loaded suppliers')).toBeVisible()
})

test('an unavailable catalogue keeps the selection and never claims an empty list', () => {
  picker({ status: 'unavailable', candidates: [], value: { pk: '7', label: 'Mouser Electronics' } })
  expect(screen.getByText(/Supplier search unavailable/)).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Supplier' })).toHaveAccessibleDescription(
    /Supplier search unavailable/,
  )
  expect(screen.getByText('Mouser Electronics · #7')).toBeVisible()
  expect(screen.queryByText(/No matches/)).not.toBeInTheDocument()
})

test('create opens a draft for the typed name instead of selecting or creating a record', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  const { onChange, input } = picker({ onCreate, createLabel: 'New supplier' })
  await user.type(input, 'Rare Parts')
  await user.click(await screen.findByRole('option', { name: 'New supplier “Rare Parts”' }))
  expect(onCreate).toHaveBeenCalledExactlyOnceWith('Rare Parts')
  expect(onChange).not.toHaveBeenCalled()
})

test('disabled picker cannot open and explains why', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  picker({ disabled: true, disabledReason: 'No supplier is selected.' })
  const input = screen.getByRole('combobox', { name: 'Supplier' })
  expect(input).toBeDisabled()
  expect(input).toHaveAccessibleDescription(/No supplier is selected\./)
  await user.click(input)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(within(document.body).getByText('No supplier is selected.')).toBeVisible()
})

test('a failed search is disclosed instead of reported as an empty result', async () => {
  const user = userEvent.setup()

  const search: PickerSearch = async () => {
    throw new Error('catalogue_unavailable')
  }

  const { input } = picker({ search })
  await user.type(input, 'Oscilloscope')
  expect(await screen.findByText(/Supplier search unavailable for this query/)).toBeVisible()
  expect(
    screen.getByText(/Supplier search unavailable; no matches in the loaded suppliers/),
  ).toBeVisible()
  expect(screen.queryByText('No matches in the loaded suppliers')).not.toBeInTheDocument()
})

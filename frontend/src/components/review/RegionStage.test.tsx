import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { RegionStage } from './RegionStage'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe() {
        this.callback(
          [{ contentRect: { width: 400 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }

      disconnect() {}

      unobserve() {}
    },
  )
})

const page = (number: number) => ({
  page: number,
  preview_id: `p${number}`,
  width: 800,
  height: 600,
})

const evidence = (pages: ReturnType<typeof page>[]) =>
  ({ id: 'e', label: 'Front', versions: [{ id: 'v', kind: 'original', pages }] }) as never

const observations = [
  {
    id: 'o',
    status: 'active',
    evidence_version_id: 'v',
    page: 1,
    region: {
      kind: 'pixels',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      source_width: 800,
      source_height: 600,
    },
    readings: { markings: ['1N4148'], text: null },
  },
] as never

const stage = (pages: ReturnType<typeof page>[]) => (
  <RegionStage
    batchId="b"
    evidence={evidence(pages)}
    label="Front"
    observations={observations}
    disabled={false}
    save={async () => true}
  />
)

it('measures the photo once its pages arrive after the editor opened', () => {
  const view = render(stage([]))
  view.rerender(stage([page(1)]))
  const outline = view.container.querySelector<HTMLElement>(
    '[aria-hidden="true"] > span',
  )!.parentElement!
  // 200 source pixels at 400 / 800 scale.
  expect(outline.style.width).toBe('100px')
})

it('a page whose preview failed does not stop another page loading', async () => {
  const user = userEvent.setup()
  render(stage([page(1), page(2)]))
  fireEvent.error(screen.getByRole('img', { name: 'Front, page 1' }))
  expect(screen.queryByRole('img', { name: 'Front, page 1' })).toBeNull()
  await user.selectOptions(screen.getByLabelText('Page'), '2')
  expect(screen.getByRole('img', { name: 'Front, page 2' })).toBeInTheDocument()
})

it('will not send a region that leaves the photo, and saves it once it fits', async () => {
  const user = userEvent.setup()
  const save = vi.fn(async () => true)
  render(
    <RegionStage
      batchId="b"
      evidence={evidence([page(1)])}
      label="Front"
      observations={observations}
      disabled={false}
      save={save}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Adjust 1N4148' }))
  const left = screen.getByLabelText('Left')
  await user.clear(left)
  await user.type(left, '700')
  expect(screen.getByText(/must fit inside the photo/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save region' })).toBeDisabled()
  await user.clear(left)
  await user.type(left, '600')
  await user.click(screen.getByRole('button', { name: 'Save region' }))
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ region: expect.objectContaining({ x: 600, width: 200 }) }),
  )
})

function renderDirty(save = vi.fn(async () => true as boolean)) {
  const onDirtyChange = vi.fn()
  const view = render(
    <RegionStage
      batchId="b"
      evidence={evidence([page(1)])}
      label="Front"
      observations={observations}
      disabled={false}
      save={save}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { ...view, onDirtyChange }
}

it('adjusting a region reports unsaved work until it is saved, discarded or closed', async () => {
  const user = userEvent.setup()
  const { onDirtyChange, unmount } = renderDirty()
  await user.click(screen.getByRole('button', { name: 'Adjust 1N4148' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Discard' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  await user.click(screen.getByRole('button', { name: 'Adjust 1N4148' }))
  await user.click(screen.getByRole('button', { name: 'Save region' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  await user.click(screen.getByRole('button', { name: 'Adjust 1N4148' }))
  unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

it('a refused region save keeps the draft and the guard', async () => {
  const user = userEvent.setup()
  const { onDirtyChange } = renderDirty(vi.fn(async () => false))
  await user.click(screen.getByRole('button', { name: 'Adjust 1N4148' }))
  await user.click(screen.getByRole('button', { name: 'Save region' }))
  expect(screen.getByRole('button', { name: 'Save region' })).toBeVisible()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
})

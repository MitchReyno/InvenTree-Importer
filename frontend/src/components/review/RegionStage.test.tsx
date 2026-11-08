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

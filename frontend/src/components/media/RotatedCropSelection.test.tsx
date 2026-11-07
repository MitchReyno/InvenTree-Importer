import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RotatedCropSelection, sourceFrame } from './RotatedCropSelection'
import { fullPreview, previewImage } from '../../media/images'

const page = { preview_id: 'p', width: 10000, height: 101 }
const frame = { centerX: 5000, centerY: 50, width: 4000, height: 60, degrees: 0 }

beforeEach(() => {
  // The surface reports a 680 px width, as a dialog on a laptop would.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe() {
        this.callback(
          [{ contentRect: { width: 680 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }

      disconnect() {}

      unobserve() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

function selection(source: ReturnType<typeof previewImage>) {
  const view = render(
    <RotatedCropSelection
      source={source}
      sourceWidth={page.width}
      sourceHeight={page.height}
      frame={frame}
      aspect="free"
      disabled={false}
      change={() => {}}
    />,
  )
  const target = screen.getByLabelText('Rotating crop selection')
  const geometry = ['width', 'height', 'transform'].map((name) =>
    target.style.getPropertyValue(name),
  )
  const image = screen.getByAltText('Fixed orientation-normalized source')
  const fit = getComputedStyle(image).objectFit
  view.unmount()
  return { geometry, fit, src: image.getAttribute('src') }
}

it('maps a selection identically over a rounded view rendition and the full page', () => {
  const sized = selection(previewImage('b', page, 'viewer'))
  const full = selection(fullPreview('b', page))
  // The 2048 × 21 view rounds the 10000 × 101 aspect ratio; filling the surface keeps it exact.
  expect(sized.src).toContain('size=view')
  expect(sized.geometry).toEqual(full.geometry)
  // 4000 × 60 source pixels at 680 / 10000 = 0.068 scale, positioned by its transform.
  expect(sized.geometry[0]).toBe('272px')
  expect(sized.geometry[2]).toContain('translate(204px')
  expect(sized.fit).toBe('fill')
})

it('converts a gesture to source pixels from the surface scale alone', () => {
  // A 272 × 4.08 box at (204, 0.36) on a 680 px surface over a 10000 px page.
  const scale = 680 / page.width
  expect(sourceFrame([204, 0.36], 272, 4.08, 0, scale)).toEqual({
    centerX: 5000,
    centerY: 35.294118,
    width: 4000,
    height: 60,
    degrees: 0,
  })
})

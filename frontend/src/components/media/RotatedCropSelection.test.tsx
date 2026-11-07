import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RotatedCropSelection } from './RotatedCropSelection'
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
  const geometry = ['left', 'top', 'width', 'height'].map((name) =>
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
  expect(sized.fit).toBe('fill')
})

import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createElectronicsCurrent } from '#/electronics-current/scene'
import { mastheadStyleController, type MastheadStyle } from '#/theme/masthead-style'
import { MastheadBackdrop } from './MastheadBackdrop'

vi.mock('#/electronics-current/scene', () => ({ createElectronicsCurrent: vi.fn() }))

const createScene = vi.mocked(createElectronicsCurrent)
const scenes: { dispose: ReturnType<typeof vi.fn> }[] = []

function choose(style: MastheadStyle): void {
  act(() => mastheadStyleController().choose(style))
}

function liveScenes() {
  return scenes.filter((scene) => scene.dispose.mock.calls.length === 0)
}

beforeEach(() => {
  scenes.length = 0
  createScene.mockReset()
  createScene.mockImplementation(() => {
    const scene = {
      setPointer: vi.fn(),
      clearPointer: vi.fn(),
      setTheme: vi.fn(),
      dispose: vi.fn(),
    }
    scenes.push(scene)

    return scene
  })
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  )
  mastheadStyleController().choose('bar')
})

afterEach(() => {
  vi.unstubAllGlobals()
  mastheadStyleController().choose('bar')
})

test('draws no field while the current lives in the bar', async () => {
  render(<MastheadBackdrop width="content" />)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(screen.queryByTestId('masthead-field')).not.toBeInTheDocument()
  expect(createScene).not.toHaveBeenCalled()
})

test.each(['window', 'fade'] as const)('draws a decorative field for %s', async (style) => {
  choose(style)
  render(<MastheadBackdrop width="content" />)

  const field = screen.getByTestId('masthead-field')
  expect(field).toHaveAttribute('data-style', style)
  expect(field).toHaveAttribute('aria-hidden', 'true')
  await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1))
  expect(createScene.mock.calls[0][1]).toMatchObject({ layout: 'field' })
})

test('each style change releases the previous scene and leaves one canvas', async () => {
  render(
    <StrictMode>
      <MastheadBackdrop width="content" />
    </StrictMode>,
  )

  for (const style of ['window', 'fade', 'window', 'bar'] as const) {
    choose(style)
    await waitFor(() => expect(liveScenes()).toHaveLength(style === 'bar' ? 0 : 1))
    expect(screen.queryAllByTestId('electronics-current')).toHaveLength(style === 'bar' ? 0 : 1)
  }

  scenes.forEach((scene) => expect(scene.dispose).toHaveBeenCalledTimes(1))
})

test('a switch before the scene loads never starts the old one', async () => {
  render(
    <StrictMode>
      <MastheadBackdrop width="content" />
    </StrictMode>,
  )

  choose('window')
  choose('fade')

  await waitFor(() => expect(liveScenes()).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(liveScenes()).toHaveLength(1)
  expect(screen.getByTestId('masthead-field')).toHaveAttribute('data-style', 'fade')
})

test('the whole-window field sits behind the page without a stacking context around it', () => {
  choose('window')
  render(<MastheadBackdrop width="content" />)
  const style = getComputedStyle(screen.getByTestId('masthead-field'))

  expect(style.position).toBe('fixed')
  expect(style.zIndex).toBe('-1')
  expect(style.pointerEvents).toBe('none')
})

test('fading down keeps parts out of the page content column for each page width', () => {
  choose('fade')
  const { rerender } = render(<MastheadBackdrop width="content" />)

  const styles = () =>
    [...document.querySelectorAll('style')].map((node) => node.textContent).join('')

  expect(styles()).toContain('var(--width-content)')
  rerender(<MastheadBackdrop width="review" />)
  expect(styles()).toContain('var(--width-review)')
  expect(screen.getByTestId('masthead-field')).toHaveAttribute('data-style', 'fade')
})

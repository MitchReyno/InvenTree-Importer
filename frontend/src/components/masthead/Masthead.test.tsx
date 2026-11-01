import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createElectronicsCurrent } from '../../electronics-current/scene'
import { Masthead } from './Masthead'

vi.mock('../../electronics-current/scene', () => ({ createElectronicsCurrent: vi.fn() }))

const createScene = vi.mocked(createElectronicsCurrent)

function stubController() {
  const controller = { setPointer: vi.fn(), clearPointer: vi.fn(), dispose: vi.fn() }
  createScene.mockReturnValue(controller)

  return controller
}

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduced })),
  )
}

beforeEach(() => {
  createScene.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('shows the brand and workflow label over a decorative canvas', () => {
  render(<Masthead />)

  expect(screen.getByText('Bench')).toBeVisible()
  expect(screen.getByText('Intake')).toBeVisible()
  expect(screen.getByText('Manual workflow')).toBeVisible()
  expect(screen.getByTestId('electronics-current')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByRole('banner')).toHaveTextContent('Bench Intake')
})

test('never loads the scene without WebGL 2', async () => {
  render(<Masthead />)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(createScene).not.toHaveBeenCalled()
})

test('starts the scene with the reduced-motion preference and forwards the pointer', async () => {
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  stubReducedMotion(true)
  const controller = stubController()
  render(<Masthead />)

  await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1))
  expect(createScene.mock.calls[0][1]).toEqual({ reducedMotion: true })

  fireEvent.pointerMove(window, { clientX: 40, clientY: 20 })
  expect(controller.setPointer).toHaveBeenCalled()
})

test('disposes the scene on unmount', async () => {
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  stubReducedMotion(false)
  const controller = stubController()
  const { unmount } = render(<Masthead />)
  await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1))

  unmount()

  expect(controller.dispose).toHaveBeenCalledTimes(1)
})

test('does not start a scene when unmounted before the scene chunk loads', async () => {
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  stubReducedMotion(false)
  stubController()
  const { unmount } = render(<Masthead />)

  unmount()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(createScene).not.toHaveBeenCalled()
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createElectronicsCurrent } from '#/electronics-current/scene'
import { Masthead } from './Masthead'

vi.mock('#/electronics-current/scene', () => ({ createElectronicsCurrent: vi.fn() }))

const createScene = vi.mocked(createElectronicsCurrent)

function stubController() {
  const controller = {
    setPointer: vi.fn(),
    clearPointer: vi.fn(),
    setTheme: vi.fn(),
    dispose: vi.fn(),
  }
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

function precedes(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

test('shows the brand, dev mode label and workflow label over a decorative canvas', () => {
  render(<Masthead />)

  expect(screen.getByText('Bench')).toBeVisible()
  expect(screen.getByText('Intake')).toBeVisible()
  // At phone width the badge shows "Dev"; its text is still "Dev mode" for assistive technology.
  expect(screen.getByText('Dev')).toHaveTextContent('Dev mode')
  expect(screen.getByText('Dev')).toBeVisible()
  expect(screen.getByText('Manual workflow')).toBeVisible()
  expect(screen.getByTestId('electronics-current')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByRole('banner')).toHaveTextContent('Bench Intake')
})

test('orders the bar: wordmark, dev badge, breadcrumb, then the status group with no menu of its own', () => {
  render(
    <Masthead breadcrumb={[{ label: 'Batches', href: '#' }]} status={<span>Status slot</span>} />,
  )
  const order = [
    screen.getByRole('link', { name: 'Bench Intake, Batches' }),
    screen.getByText('Dev'),
    screen.getByRole('navigation', { name: 'Breadcrumb' }),
    screen.getByText('Status slot'),
  ]

  order.slice(1).forEach((element, index) => expect(precedes(order[index], element)).toBe(true))
  expect(screen.getByRole('link', { name: 'Bench Intake, Batches' })).toHaveAttribute('href', '#')
  // Theme and app links moved to the server menu and Settings; the bar keeps no "⋯" menu.
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
})

test('hides only the breadcrumb at phone width', () => {
  render(
    <Masthead breadcrumb={[{ label: 'Batches', href: '#' }]} status={<span>Status slot</span>} />,
  )

  expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).parentElement).toHaveAttribute(
    'data-compact',
    'hidden',
  )
  // The trail opens with a separator after the Dev badge, as on the canvas.
  const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' }).parentElement!
  expect(crumbs.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  expect(crumbs.firstElementChild).toHaveTextContent('/')
  expect(screen.getByText('Status slot').closest('[data-compact="hidden"]')).toBeNull()
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
  expect(createScene.mock.calls[0][1]).toEqual({ reducedMotion: true, theme: 'light' })

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

test('starts the scene in the page theme and follows theme changes', async () => {
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  stubReducedMotion(false)
  const controller = stubController()
  document.documentElement.dataset.theme = 'dark'
  const { unmount } = render(<Masthead />)

  await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1))
  expect(createScene.mock.calls[0][1]).toEqual({ reducedMotion: false, theme: 'dark' })

  document.documentElement.dataset.theme = 'light'
  await waitFor(() => expect(controller.setTheme).toHaveBeenCalledWith('light'))
  unmount()
  delete document.documentElement.dataset.theme
})

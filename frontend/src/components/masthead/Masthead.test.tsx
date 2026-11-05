import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createElectronicsCurrent } from '../../electronics-current/scene'
import { createThemeController } from '../../theme/theme'
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

function fakeThemeController() {
  const root = document.createElement('html')
  const values = new Map<string, string>()
  const controller = createThemeController({
    storage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }),
    media: () => undefined,
    root,
  })

  return { controller, root }
}

function precedes(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

test('shows the brand, dev mode label and workflow label over a decorative canvas', () => {
  render(<Masthead themeController={fakeThemeController().controller} />)

  expect(screen.getByText('Bench')).toBeVisible()
  expect(screen.getByText('Intake')).toBeVisible()
  expect(screen.getByText('Dev mode')).toBeVisible()
  expect(screen.getByText('Manual workflow')).toBeVisible()
  expect(screen.getByTestId('electronics-current')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByRole('banner')).toHaveTextContent('Bench Intake')
})

test('orders the bar: wordmark, dev badge, breadcrumb, status, then the menu', () => {
  render(
    <Masthead
      themeController={fakeThemeController().controller}
      breadcrumb={[{ label: 'Batches', href: '#' }, { label: 'Bench bag' }]}
      status={<span>Status slot</span>}
    />,
  )
  const order = [
    screen.getByRole('link', { name: 'Bench Intake, Batches' }),
    screen.getByText('Dev mode'),
    screen.getByRole('navigation', { name: 'Breadcrumb' }),
    screen.getByText('Status slot'),
    screen.getByRole('button', { name: 'More' }),
  ]

  order.slice(1).forEach((element, index) => expect(precedes(order[index], element)).toBe(true))
  expect(screen.getByRole('link', { name: 'Bench Intake, Batches' })).toHaveAttribute('href', '#')
})

test('hides only the breadcrumb at phone width', () => {
  render(
    <Masthead
      themeController={fakeThemeController().controller}
      breadcrumb={[{ label: 'Batches', href: '#' }]}
      status={<span>Status slot</span>}
    />,
  )

  expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).parentElement).toHaveAttribute(
    'data-compact',
    'hidden',
  )
  expect(screen.getByText('Status slot').closest('[data-compact="hidden"]')).toBeNull()
  expect(screen.getByRole('button', { name: 'More' }).closest('[data-compact="hidden"]')).toBeNull()
})

test('the overflow menu links to Agents and Agent settings and switches the theme', async () => {
  const { controller, root } = fakeThemeController()
  const user = userEvent.setup()
  render(<Masthead themeController={controller} />)

  await user.click(screen.getByRole('button', { name: 'More' }))
  expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '#agents')
  expect(screen.getByRole('link', { name: 'Agent settings' })).toHaveAttribute('href', '#settings')
  const theme = screen.getByRole('radiogroup', { name: 'Theme' })
  expect(within(theme).getByRole('radio', { name: 'System' })).toBeChecked()

  await user.click(within(theme).getByRole('radio', { name: 'Dark' }))
  expect(root.dataset.theme).toBe('dark')
  expect(within(theme).getByRole('radio', { name: 'Dark' })).toBeChecked()

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('radiogroup', { name: 'Theme' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'More' })).toHaveFocus()
})

test('never loads the scene without WebGL 2', async () => {
  render(<Masthead themeController={fakeThemeController().controller} />)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(createScene).not.toHaveBeenCalled()
})

test('starts the scene with the reduced-motion preference and forwards the pointer', async () => {
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  stubReducedMotion(true)
  const controller = stubController()
  render(<Masthead themeController={fakeThemeController().controller} />)

  await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1))
  expect(createScene.mock.calls[0][1]).toEqual({ reducedMotion: true })

  fireEvent.pointerMove(window, { clientX: 40, clientY: 20 })
  expect(controller.setPointer).toHaveBeenCalled()
})

test('disposes the scene on unmount', async () => {
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  stubReducedMotion(false)
  const controller = stubController()
  const { unmount } = render(<Masthead themeController={fakeThemeController().controller} />)
  await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1))

  unmount()

  expect(controller.dispose).toHaveBeenCalledTimes(1)
})

test('does not start a scene when unmounted before the scene chunk loads', async () => {
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {})
  stubReducedMotion(false)
  stubController()
  const { unmount } = render(<Masthead themeController={fakeThemeController().controller} />)

  unmount()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(createScene).not.toHaveBeenCalled()
})

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useNavigationGuard } from './useNavigationGuard'

type Guard = ReturnType<typeof useNavigationGuard>

let guard: Guard

function Page() {
  guard = useNavigationGuard()
  return (
    <>
      <a href="#batches">Batches</a>
      <a href="#capture">Capture</a>
      <a href="#settings/agents/tags">Tag suggestions</a>
      <output>{guard.route}</output>
      {guard.navigationBlocked && <p role="alert">Blocked</p>}
    </>
  )
}

beforeEach(() => {
  history.replaceState(null, '', '#settings/agents')
})

afterEach(() => {
  history.replaceState(null, '', '#')
})

async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })
}

test('a link first saves what can be saved, then continues once it is confirmed', async () => {
  render(<Page />)

  let finish: (saved: boolean) => void = () => {}

  const beforeLeave = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = (saved) => {
          act(() => guard.onDirtyChange(!saved))
          resolve(saved)
        }
      }),
  )
  act(() => guard.onDirtyChange(true, beforeLeave))
  fireEvent.click(screen.getByRole('link', { name: 'Batches' }))
  expect(beforeLeave).toHaveBeenCalledOnce()
  expect(location.hash).toBe('#settings/agents')
  finish(true)
  await settle()
  expect(location.hash).toBe('#batches')
  expect(screen.getByRole('status')).toHaveTextContent('batches')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('a link stays put, with the guard shown, when the save fails', async () => {
  render(<Page />)
  act(() => guard.onDirtyChange(true, async () => false))
  fireEvent.click(screen.getByRole('link', { name: 'Batches' }))
  await settle()
  expect(location.hash).toBe('#settings/agents')
  expect(screen.getByRole('alert')).toHaveTextContent('Blocked')
})

test('Back saves first too, then goes where it was asked', async () => {
  history.replaceState(null, '', '#batches')
  history.pushState(null, '', '#settings/agents')
  render(<Page />)
  act(() =>
    guard.onDirtyChange(true, async () => {
      guard.onDirtyChange(false)
      return true
    }),
  )
  await act(async () => {
    history.back()
    await new Promise((done) => setTimeout(done, 20))
  })
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20))
  })
  expect(location.hash).toBe('#batches')
  expect(screen.getByRole('status')).toHaveTextContent('batches')
})

test('reload and close keep the leave prompt while anything is unsaved', () => {
  render(<Page />)
  act(() => guard.onDirtyChange(true, async () => true))
  const event = new Event('beforeunload', { cancelable: true })
  dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  act(() => guard.onDirtyChange(false))
  const clean = new Event('beforeunload', { cancelable: true })
  dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
})

test('two links while the save runs lead once, to the last one chosen', async () => {
  render(<Page />)
  const visited: string[] = []

  const record = () => visited.push(location.hash)

  addEventListener('hashchange', record)

  let finish: () => void = () => {}

  const beforeLeave = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => {
          act(() => guard.onDirtyChange(false))
          resolve(true)
        }
      }),
  )
  act(() => guard.onDirtyChange(true, beforeLeave))
  fireEvent.click(screen.getByRole('link', { name: 'Batches' }))
  fireEvent.click(screen.getByRole('link', { name: 'Capture' }))
  expect(beforeLeave).toHaveBeenCalledOnce()
  finish()
  await settle()
  expect(location.hash).toBe('#capture')
  expect(visited).toEqual(['#capture'])
  removeEventListener('hashchange', record)
})

test('moving to another Agents subsection drops a departure waiting for the save', async () => {
  render(<Page />)

  let finish: () => void = () => {}

  const beforeLeave = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => {
          act(() => guard.onDirtyChange(false))
          resolve(true)
        }
      }),
  )
  act(() => guard.onDirtyChange(true, beforeLeave))
  fireEvent.click(screen.getByRole('link', { name: 'Batches' }))
  fireEvent.click(screen.getByRole('link', { name: 'Tag suggestions' }))
  await settle()
  finish()
  await settle()
  expect(location.hash).toBe('#settings/agents/tags')
})

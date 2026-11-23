import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useFileDrop } from './useFileDrop'

function Target({ withTile, onFiles }: { withTile: boolean; onFiles: (files: File[]) => void }) {
  const drop = useFileDrop(onFiles, () => true)
  return (
    <section aria-label="Target" data-drop={drop.over ? 'over' : undefined} {...drop.handlers}>
      {withTile && <button type="button">Tile</button>}
      <button type="button">Other</button>
    </section>
  )
}

const files = { dataTransfer: { files: [], types: ['Files'] } }

test('the highlight clears on leaving even after the hovered child was removed', () => {
  const view = render(<Target withTile onFiles={vi.fn()} />)
  const target = screen.getByRole('region', { name: 'Target' })
  const tile = screen.getByRole('button', { name: 'Tile' })
  fireEvent.dragEnter(target, files)
  fireEvent.dragEnter(tile, files)
  fireEvent.dragLeave(target, files)
  expect(target).toHaveAttribute('data-drop', 'over')

  // The tile goes while the files hover over it, so its dragleave never reaches the target.
  view.rerender(<Target withTile={false} onFiles={vi.fn()} />)
  const other = screen.getByRole('button', { name: 'Other' })
  fireEvent.dragEnter(other, files)
  fireEvent.dragLeave(tile, files)
  fireEvent.dragLeave(other, files)

  expect(target).not.toHaveAttribute('data-drop', 'over')
})

test('the highlight clears when files leave straight from a removed child', () => {
  const view = render(<Target withTile onFiles={vi.fn()} />)
  const target = screen.getByRole('region', { name: 'Target' })
  fireEvent.dragEnter(screen.getByRole('button', { name: 'Tile' }), files)
  expect(target).toHaveAttribute('data-drop', 'over')

  view.rerender(<Target withTile={false} onFiles={vi.fn()} />)
  fireEvent.dragOver(document.body, files)

  expect(target).not.toHaveAttribute('data-drop', 'over')
})

test('a drag that carries no files is left alone', () => {
  const onFiles = vi.fn()
  render(<Target withTile onFiles={onFiles} />)
  const target = screen.getByRole('region', { name: 'Target' })

  const notCancelled = fireEvent.dragOver(target, { dataTransfer: { types: ['text/plain'] } })

  expect(notCancelled).toBe(true)
  expect(target).not.toHaveAttribute('data-drop', 'over')
})

function Inner() {
  const drop = useFileDrop(vi.fn(), () => true)
  return (
    <section aria-label="Inner" data-drop={drop.over ? 'over' : undefined} {...drop.handlers}>
      Inner
    </section>
  )
}

function Outer({ withTile }: { withTile: boolean }) {
  const drop = useFileDrop(vi.fn(), () => true)
  return (
    <section aria-label="Outer" data-drop={drop.over ? 'over' : undefined} {...drop.handlers}>
      {withTile && <button type="button">Tile</button>}
      <Inner />
    </section>
  )
}

test('moving from a removed child onto an inner target leaves only the inner one highlighted', () => {
  const view = render(<Outer withTile />)
  const outer = screen.getByRole('region', { name: 'Outer' })
  fireEvent.dragEnter(screen.getByRole('button', { name: 'Tile' }), files)
  expect(outer).toHaveAttribute('data-drop', 'over')

  view.rerender(<Outer withTile={false} />)
  const inner = screen.getByRole('region', { name: 'Inner' })
  fireEvent.dragEnter(inner, files)
  fireEvent.dragOver(inner, files)

  expect(inner).toHaveAttribute('data-drop', 'over')
  expect(outer).not.toHaveAttribute('data-drop', 'over')
})

function Gated({ open }: { open: boolean }) {
  const drop = useFileDrop(vi.fn(), () => open)
  return (
    <section aria-label="Gated" data-drop={drop.over ? 'over' : undefined} {...drop.handlers}>
      Gated
    </section>
  )
}

test('the highlight follows the gate while files hover', () => {
  const view = render(<Gated open={false} />)
  const target = screen.getByRole('region', { name: 'Gated' })
  fireEvent.dragEnter(target, files)
  expect(target).not.toHaveAttribute('data-drop', 'over')

  view.rerender(<Gated open />)
  fireEvent.dragOver(target, files)
  expect(target).toHaveAttribute('data-drop', 'over')

  view.rerender(<Gated open={false} />)
  fireEvent.dragOver(target, files)
  expect(target).not.toHaveAttribute('data-drop', 'over')
})

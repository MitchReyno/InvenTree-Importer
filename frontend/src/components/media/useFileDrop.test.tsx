import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useFileDrop } from './useFileDrop'

function Target({ withTile, onFiles }: { withTile: boolean; onFiles: (files: File[]) => void }) {
  const drop = useFileDrop(onFiles, true)
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

test('a drag that carries no files is left alone', () => {
  const onFiles = vi.fn()
  render(<Target withTile onFiles={onFiles} />)
  const target = screen.getByRole('region', { name: 'Target' })

  const notCancelled = fireEvent.dragOver(target, { dataTransfer: { types: ['text/plain'] } })

  expect(notCancelled).toBe(true)
  expect(target).not.toHaveAttribute('data-drop', 'over')
})

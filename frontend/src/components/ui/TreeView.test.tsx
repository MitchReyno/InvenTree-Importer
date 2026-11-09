import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { Pill } from './Pill'
import { TreeView, type TreeNode } from './TreeView'

const nodes: TreeNode[] = [
  {
    id: 'cat',
    kind: 'Category',
    label: 'Passives › Resistors › SMD',
    status: <Pill status="exists">Exists</Pill>,
    children: [
      {
        id: 'part',
        kind: 'Part',
        label: 'RES-0144',
        status: <Pill status="new">New</Pill>,
        children: [
          { id: 's1', kind: 'Stock item', label: '500 pcs' },
          { id: 's2', kind: 'Stock item', label: '380 pcs', dimmed: true },
        ],
      },
    ],
  },
  { id: 'loc', kind: 'Location', label: 'Drawer 4' },
]

test('a WAI-ARIA tree with one tab stop, kind labels and levels', async () => {
  render(<TreeView label="What will change" nodes={nodes} />)
  const tree = screen.getByRole('tree', { name: 'What will change' })
  const items = screen.getAllByRole('treeitem')

  expect(tree).toBeInTheDocument()
  expect(items).toHaveLength(5)
  expect(items[0]).toHaveTextContent('CategoryPassives › Resistors › SMD')
  expect(items[0]).toHaveAttribute('aria-expanded', 'true')
  expect(items[2]).toHaveAttribute('aria-level', '3')
  expect(items[3]).toHaveAttribute('data-dimmed', 'true')
  expect(items.filter((item) => item.tabIndex === 0)).toEqual([items[0]])
  await userEvent.tab()
  expect(items[0]).toHaveFocus()
})

test('arrows move, collapse and expand; Home and End jump', async () => {
  const user = userEvent.setup()
  render(<TreeView label="What will change" nodes={nodes} />)
  await user.tab()

  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('treeitem', { name: /RES-0144/ })).toHaveFocus()
  await user.keyboard('{ArrowLeft}')
  expect(screen.queryByRole('treeitem', { name: /500 pcs/ })).toBeNull()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('treeitem', { name: /500 pcs/ })).toBeInTheDocument()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('treeitem', { name: /500 pcs/ })).toHaveFocus()
  await user.keyboard('{ArrowLeft}')
  expect(screen.getByRole('treeitem', { name: /RES-0144/ })).toHaveFocus()
  await user.keyboard('{End}')
  expect(screen.getByRole('treeitem', { name: /Drawer 4/ })).toHaveFocus()
  await user.keyboard('{Home}')
  expect(screen.getByRole('treeitem', { name: /Passives/ })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getAllByRole('treeitem')).toHaveLength(2)
})

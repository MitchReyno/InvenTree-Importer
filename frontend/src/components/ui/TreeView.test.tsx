import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Pill } from './Pill'
import { TreeView, parentIds, type TreeNode } from './TreeView'

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

test('keys pressed on a link inside a row reach the link', async () => {
  const user = userEvent.setup()
  const follow = vi.fn((event: Event) => event.preventDefault())
  render(
    <TreeView
      label="What will change"
      nodes={[
        {
          id: 'lot',
          kind: 'Lot',
          label: 'Bench bag',
          detail: (
            <a href="#review" onClick={(event) => follow(event.nativeEvent)}>
              Review
            </a>
          ),
          children: [{ id: 'part', kind: 'Part', label: 'RES-0144' }],
        },
      ]}
    />,
  )
  const link = screen.getByRole('link', { name: 'Review' })
  link.focus()

  await user.keyboard('{Enter}')
  expect(follow).toHaveBeenCalledTimes(1)
  await user.keyboard('{ArrowDown}')
  expect(link).toHaveFocus()
  expect(screen.getAllByRole('treeitem')).toHaveLength(2)
})

test('a parent can drive which nodes are collapsed', async () => {
  const user = userEvent.setup()

  function Controlled() {
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

    return (
      <>
        <button type="button" onClick={() => setCollapsed(new Set(parentIds(nodes)))}>
          Collapse all
        </button>
        <button type="button" onClick={() => setCollapsed(new Set())}>
          Expand all
        </button>
        <TreeView
          label="What will change"
          nodes={nodes}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        />
      </>
    )
  }

  render(<Controlled />)
  await user.click(screen.getByRole('button', { name: 'Collapse all' }))
  expect(screen.getAllByRole('treeitem')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Expand all' }))
  expect(screen.getAllByRole('treeitem')).toHaveLength(5)

  await user.click(screen.getByRole('treeitem', { name: /RES-0144/ }))
  expect(screen.getAllByRole('treeitem')).toHaveLength(3)
})

test('selects nothing: rows carry no aria-selected', () => {
  render(<TreeView label="What will change" nodes={nodes} />)

  for (const item of screen.getAllByRole('treeitem')) {
    expect(item).not.toHaveAttribute('aria-selected')
  }
})

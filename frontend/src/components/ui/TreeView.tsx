import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, icon, opacity, radius, space, type, typeVar } from '#/theme/generated/tokens'

export type TreeNode = {
  id: string
  /** The record kind, such as "Part" or "Stock item". */
  kind: string
  label: ReactNode
  detail?: ReactNode
  /** Usually a `Pill`: New, Update, Exists or a decision to make. */
  status?: ReactNode
  /** An unticked lot's records stay in place, faded. */
  dimmed?: boolean
  children?: TreeNode[]
}

type Row = { node: TreeNode; level: number; parent: string | null; position: number; size: number }

type TreeViewProps = {
  label: string
  nodes: TreeNode[]
}

function visibleRows(nodes: TreeNode[], collapsed: Set<string>) {
  const rows: Row[] = []

  const walk = (list: TreeNode[], level: number, parent: string | null) => {
    list.forEach((node, index) => {
      rows.push({ node, level, parent, position: index + 1, size: list.length })
      if (node.children?.length && !collapsed.has(node.id)) {
        walk(node.children, level + 1, node.id)
      }
    })
  }

  walk(nodes, 1, null)
  return rows
}

/** Records in InvenTree's own hierarchy, as a WAI-ARIA tree: one tab stop, arrows move and fold. */
export function TreeView({ label, nodes }: TreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const items = useRef(new Map<string, HTMLLIElement>())
  const rows = useMemo(() => visibleRows(nodes, collapsed), [nodes, collapsed])
  const current = rows.some((row) => row.node.id === focused) ? focused : rows[0]?.node.id

  function move(id: string | undefined) {
    if (id) {
      setFocused(id)
      items.current.get(id)?.focus()
    }
  }

  function setOpen(id: string, open: boolean) {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (open) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleKeyDown(event: KeyboardEvent, row: Row) {
    const index = rows.indexOf(row)
    const id = row.node.id
    const parent = Boolean(row.node.children?.length)
    const open = parent && !collapsed.has(id)
    const actions: Record<string, () => void> = {
      ArrowDown: () => move(rows[index + 1]?.node.id),
      ArrowUp: () => move(rows[index - 1]?.node.id),
      Home: () => move(rows[0]?.node.id),
      End: () => move(rows.at(-1)?.node.id),
      ArrowRight: () => {
        if (parent && !open) {
          setOpen(id, true)
        } else if (open) {
          move(row.node.children?.[0]?.id)
        }
      },
      ArrowLeft: () => {
        if (open) {
          setOpen(id, false)
        } else {
          move(row.parent ?? undefined)
        }
      },
      Enter: () => parent && setOpen(id, !open),
      ' ': () => parent && setOpen(id, !open),
    }
    const action = actions[event.key]

    if (action) {
      event.preventDefault()
      action()
    }
  }

  return (
    <Tree role="tree" aria-label={label}>
      {rows.map((row) => {
        const { node } = row
        const parent = Boolean(node.children?.length)
        const open = parent && !collapsed.has(node.id)

        return (
          <Item
            key={node.id}
            ref={(element) => {
              if (element) {
                items.current.set(node.id, element)
              } else {
                items.current.delete(node.id)
              }
            }}
            role="treeitem"
            aria-level={row.level}
            aria-setsize={row.size}
            aria-posinset={row.position}
            aria-expanded={parent ? open : undefined}
            aria-selected={node.id === current}
            tabIndex={node.id === current ? 0 : -1}
            data-dimmed={node.dimmed || undefined}
            $level={row.level}
            onKeyDown={(event) => handleKeyDown(event, row)}
            onFocus={() => setFocused(node.id)}
            onClick={() => {
              move(node.id)
              if (parent) {
                setOpen(node.id, !open)
              }
            }}
          >
            <Twisty aria-hidden="true">{parent ? (open ? '▾' : '▸') : ''}</Twisty>
            <Kind>{node.kind}</Kind>
            <Record>{node.label}</Record>
            {node.detail && <Detail>{node.detail}</Detail>}
            {node.status}
          </Item>
        )
      })}
    </Tree>
  )
}

const Tree = styled.ul`
  display: grid;
  gap: ${space[1]};
  margin: 0;
  padding: 0;
  list-style: none;
`

// Each level indents by the twisty's width plus the gap, so children line up under their parent.
const Item = styled.li<{ $level: number }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  padding: 5px ${space[4]};
  padding-left: calc(${space[4]} + ${({ $level }) => ($level - 1) * 22}px);
  border-radius: ${radius.input};
  cursor: default;
  overflow-wrap: anywhere;
  &:hover,
  &[aria-selected='true'] {
    background: ${color.surface2};
  }
  &[data-dimmed='true'] > * {
    opacity: ${opacity.muted};
  }
`

const Twisty = styled.span`
  width: ${icon.sm};
  color: ${color.muted};
  /* literal-allowed: the disclosure glyph sits a step under the label text */
  font-size: 11px;
  text-align: center;
`

const Kind = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Record = styled.b`
  font-weight: ${typeVar.bodyStrong.weight};
`

const Detail = styled.span`
  color: ${color.muted};
`

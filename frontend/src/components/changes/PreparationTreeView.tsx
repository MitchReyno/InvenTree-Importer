import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import styled from 'styled-components'
import type { TreeItem } from '../../changes/model'
import { STATE_LABELS } from '../../changes/model'
import { RecordStatePill } from '../ui/RecordStatePill'
import { color, radius, space } from '../../theme/generated/tokens'
import { Small } from '../ui/primitives'

type Visible = {
  item: TreeItem
  level: number
  parent: string | null
  position: number
  size: number
}

/** A WAI-ARIA tree: one tab stop; arrows move, expand and collapse; Home and End jump. */
export function PreparationTreeView({ label, items }: { label: string; items: TreeItem[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(items[0]?.node.key ?? null)
  const refs = useRef(new Map<string, HTMLLIElement>())

  const visible = useMemo(() => {
    const rows: Visible[] = []

    const walk = (list: TreeItem[], level: number, parent: string | null) => {
      list.forEach((item, index) => {
        rows.push({ item, level, parent, position: index + 1, size: list.length })
        if (item.children.length && !collapsed.has(item.node.key)) {
          walk(item.children, level + 1, item.node.key)
        }
      })
    }

    walk(items, 1, null)
    return rows
  }, [items, collapsed])

  const current = visible.find((row) => row.item.node.key === focused)
    ? focused
    : visible[0]?.item.node.key

  function move(key: string | undefined) {
    if (key) {
      setFocused(key)
      refs.current.get(key)?.focus()
    }
  }

  function toggle(key: string, open?: boolean) {
    setCollapsed((previous) => {
      const next = new Set(previous)
      const isOpen = !next.has(key)
      if (open ?? !isOpen) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function onKeyDown(event: KeyboardEvent, row: Visible) {
    const index = visible.indexOf(row)
    const key = row.item.node.key
    const expandable = row.item.children.length > 0
    const open = expandable && !collapsed.has(key)
    const handled = {
      ArrowDown: () => move(visible[index + 1]?.item.node.key),
      ArrowUp: () => move(visible[index - 1]?.item.node.key),
      Home: () => move(visible[0]?.item.node.key),
      End: () => move(visible.at(-1)?.item.node.key),
      ArrowRight: () => {
        if (expandable && !open) {
          toggle(key, true)
        } else if (open) {
          move(row.item.children[0].node.key)
        }
      },
      ArrowLeft: () => {
        if (open) {
          toggle(key, false)
        } else {
          move(row.parent ?? undefined)
        }
      },
      Enter: () => expandable && toggle(key),
      ' ': () => expandable && toggle(key),
    }[event.key]
    if (handled) {
      event.preventDefault()
      handled()
    }
  }

  return (
    <Tree role="tree" aria-label={label}>
      {visible.map((row) => {
        const { node, children } = row.item
        return (
          <Row
            key={node.key}
            ref={(element) => {
              if (element) {
                refs.current.set(node.key, element)
              } else {
                refs.current.delete(node.key)
              }
            }}
            role="treeitem"
            aria-level={row.level}
            aria-setsize={row.size}
            aria-posinset={row.position}
            aria-expanded={children.length ? !collapsed.has(node.key) : undefined}
            aria-selected={node.key === current}
            tabIndex={node.key === current ? 0 : -1}
            $level={row.level}
            onKeyDown={(event) => onKeyDown(event, row)}
            onFocus={() => setFocused(node.key)}
            onClick={() => {
              move(node.key)
              if (children.length) {
                toggle(node.key)
              }
            }}
          >
            <span aria-hidden="true">
              {children.length ? (collapsed.has(node.key) ? '▸' : '▾') : '·'}
            </span>
            <Label>
              {node.label}
              {node.detail && <Small>{node.detail}</Small>}
            </Label>
            <RecordStatePill state={node.state}>{STATE_LABELS[node.state]}</RecordStatePill>
          </Row>
        )
      })}
    </Tree>
  )
}

const Label = styled.span`
  display: grid;
  gap: ${space[1]};
`
const Tree = styled.ul`
  display: grid;
  gap: ${space[1]};
  margin: 0;
  padding: ${space[2]};
  list-style: none;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
const Row = styled.li<{ $level: number }>`
  display: grid;
  grid-template-columns: 1em minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space[4]};
  padding: ${space[2]} ${space[4]};
  padding-left: calc(${space[4]} + ${({ $level }) => ($level - 1) * 20}px);
  border-radius: ${radius.card};
  cursor: default;
  overflow-wrap: anywhere;
  &[aria-selected='true'] {
    background: ${color.surface2};
  }
`

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import styled from 'styled-components'
import type { TreeItem } from '../../changes/model'
import { STATE_LABELS, changeLines } from '../../changes/model'
import { RecordStatePill } from '../ui/RecordStatePill'
import { color, opacity, radius, space, type } from '../../theme/generated/tokens'
import { CheckboxLabel, Small } from '../ui/primitives'
import { Button } from '../ui/Button'
import { Pill } from '../ui/Pill'

type Visible = {
  item: TreeItem
  level: number
  parent: string | null
  position: number
  size: number
}

type Tally = { new: number; update: number; exists: number }

/** Every node's state below (and including) these items. */
function tally(list: TreeItem[], into: Tally = { new: 0, update: 0, exists: 0 }): Tally {
  for (const item of list) {
    const state = item.node.state as keyof Tally
    if (state in into) {
      into[state] += 1
    }
    tally(item.children, into)
  }
  return into
}

/** A lot left out changes nothing in InvenTree, so it is not a change. */
function changed(item: TreeItem): boolean {
  return (
    (item.node.state !== 'exists' && item.node.state !== 'not_ticked') ||
    item.children.some(changed)
  )
}

/** Keeps only nodes that change, with the parents that lead to them. */
function onlyChanges(list: TreeItem[]): TreeItem[] {
  return list.filter(changed).map((item) => ({ ...item, children: onlyChanges(item.children) }))
}

function expandable(list: TreeItem[]): string[] {
  return list.flatMap((item) =>
    item.children.length ? [item.node.key, ...expandable(item.children)] : [],
  )
}

function summary(counts: Tally) {
  return [
    counts.new && `${counts.new} new`,
    counts.update && `${counts.update} update`,
    counts.exists && `${counts.exists} existing`,
  ]
    .filter(Boolean)
    .join(' · ')
}

const KIND_LABELS: Record<string, string> = {
  category: 'Category',
  part: 'Part',
  parameter: 'Parameter',
  company: 'Company',
  manufacturer_part: 'Manufacturer part',
  supplier_part: 'Supplier part',
  stock_item: 'Stock item',
  location: 'Location',
}

/** A WAI-ARIA tree: one tab stop; arrows move, expand and collapse; Home and End jump. */
export function PreparationTreeView({
  label,
  items: all,
  lotHref,
}: {
  label: string
  items: TreeItem[]
  /** Review's address for a lot, for the link on a lot left out. */
  lotHref?: (lotId: string) => string
}) {
  const [changesOnly, setChangesOnly] = useState(false)
  const items = useMemo(() => (changesOnly ? onlyChanges(all) : all), [all, changesOnly])
  const counts = useMemo(() => tally(all), [all])
  const parents = expandable(items)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const anyOpen = parents.some((key) => !collapsed.has(key))
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
    <>
      <Toolbar>
        <Counts role="group" aria-label="Tree counts">
          <Pill status="new">{counts.new} new</Pill>
          <Pill status="update">{counts.update} update</Pill>
          <Pill status="exists">{counts.exists} existing</Pill>
        </Counts>
        <Button
          size="sm"
          variant="ghost"
          disabled={!parents.length}
          onClick={() => setCollapsed(anyOpen ? new Set(parents) : new Set())}
        >
          {anyOpen ? 'Collapse all' : 'Expand all'}
        </Button>
        <CheckboxLabel>
          <input
            type="checkbox"
            checked={changesOnly}
            onChange={(event) => setChangesOnly(event.target.checked)}
          />
          Only changes
        </CheckboxLabel>
      </Toolbar>
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
              data-unticked={node.state === 'not_ticked' || undefined}
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
                <Kind>{KIND_LABELS[node.kind] ?? node.kind.replaceAll('_', ' ')}</Kind>
                {node.label}
                {node.detail && <Small>{node.detail}</Small>}
                {changeLines(node).map((line) => (
                  <Small key={line}>{line}</Small>
                ))}
                {node.state === 'not_ticked' && node.lot_id && lotHref && (
                  <Small>
                    <a
                      href={lotHref(node.lot_id)}
                      aria-label={`Review ${node.label}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      Review
                    </a>
                  </Small>
                )}
                {children.length > 0 && collapsed.has(node.key) && (
                  <Small>{summary(tally(children))}</Small>
                )}
              </Label>
              <RecordStatePill state={node.state}>{STATE_LABELS[node.state]}</RecordStatePill>
            </Row>
          )
        })}
      </Tree>
    </>
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
  &[data-unticked='true'] > :not(:last-child) {
    opacity: ${opacity.muted};
  }
`

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]} ${space[5]};
  margin-bottom: ${space[4]};
`
const Counts = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  margin-right: auto;
`
const Kind = styled.span`
  ${type.label}
  margin-right: ${space[3]};
  color: ${color.muted};
`

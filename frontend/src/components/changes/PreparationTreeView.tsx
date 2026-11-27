import { useMemo, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { TreeItem } from '#/changes/model'
import { STATE_LABELS, changeLines } from '#/changes/model'
import { RecordStatePill, Button, Pill, TreeView, parentIds, type TreeNode } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
import { space } from '#/theme/generated/tokens'

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

/** A row's detail: what it carries, what an update changes, and a summary while it is folded. */
function detailOf(
  item: TreeItem,
  folded: boolean,
  lotHref: ((lotId: string) => string) | undefined,
): ReactNode {
  const { node, children } = item
  const lines = [node.detail, ...changeLines(node)].filter(Boolean)
  const reviewHref =
    node.state === 'not_ticked' && node.lot_id && lotHref ? lotHref(node.lot_id) : null
  const totals = folded && children.length > 0 ? summary(tally(children)) : ''
  if (!lines.length && !reviewHref && !totals) {
    return undefined
  }

  return (
    <Details>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
      {reviewHref && (
        <a href={reviewHref} aria-label={`Review ${node.label}`}>
          Review
        </a>
      )}
      {totals && <span>{totals}</span>}
    </Details>
  )
}

function toNodes(
  list: TreeItem[],
  collapsed: ReadonlySet<string>,
  lotHref: ((lotId: string) => string) | undefined,
): TreeNode[] {
  return list.map((item) => {
    const { node } = item

    return {
      id: node.key,
      kind: KIND_LABELS[node.kind] ?? node.kind.replaceAll('_', ' '),
      label: node.label,
      detail: detailOf(item, collapsed.has(node.key), lotHref),
      status: <RecordStatePill state={node.state}>{STATE_LABELS[node.state]}</RecordStatePill>,
      dimmed: node.state === 'not_ticked',
      children: toNodes(item.children, collapsed, lotHref),
    }
  })
}

/** The preparation as a `TreeView`, with its counts, Expand or Collapse all, and Only changes. */
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const items = useMemo(() => (changesOnly ? onlyChanges(all) : all), [all, changesOnly])
  const counts = useMemo(() => tally(all), [all])
  const nodes = toNodes(items, collapsed, lotHref)
  const parents = parentIds(nodes)
  const anyOpen = parents.some((id) => !collapsed.has(id))

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
      <TreeView
        label={label}
        nodes={nodes}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
    </>
  )
}

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
const Details = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  gap: ${space[1]} ${space[4]};
`

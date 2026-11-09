import type {
  ManualPreviewDto,
  ManualWorkspaceDto,
  PreparationNodeDto,
  PreparationNodeKind,
} from '@invimport/contracts'
import type { ReviewFilter } from '#/operator/review-model'

type Node = PreparationNodeDto
export type TreeItem = { node: Node; children: TreeItem[] }

const SECTIONS: [PreparationNodeKind, string][] = [
  ['stock_item', 'Stock items'],
  ['part', 'Parts'],
  ['category', 'Categories'],
  ['company', 'Companies'],
  ['manufacturer_part', 'Manufacturer parts'],
  ['supplier_part', 'Supplier parts'],
  ['parameter', 'Parameters'],
  ['attachment', 'Images and attachments'],
  ['location', 'Locations'],
]

export const STATE_LABELS: Record<Node['state'], string> = {
  new: 'New',
  update: 'Update',
  exists: 'Exists',
  choose: 'Choose',
  not_ticked: 'Not ticked',
}

/** An update's changes, one line each: "Image · none → Image for CAP 100nF". */
export function changeLines(node: Node) {
  return (node.changes ?? []).map(
    (change) => `${change.field} · ${change.before ?? 'none'} → ${change.after ?? 'none'}`,
  )
}

/**
 * By type: one section per record type; updates to existing records are listed on their own.
 * Lots left out of the preparation are not records it makes, so only the tree keeps them.
 */
export function byType(nodes: Node[]) {
  const sections = SECTIONS.map(([kind, title]) => ({
    title,
    nodes: nodes.filter(
      (node) => node.kind === kind && node.state !== 'update' && node.state !== 'not_ticked',
    ),
  }))
  sections.push({
    title: 'Changes to existing records',
    nodes: nodes.filter((node) => node.state === 'update'),
  })
  return sections.filter((section) => section.nodes.length > 0)
}

export function summary(nodes: Node[]) {
  return {
    new: nodes.filter((node) => node.state === 'new').length,
    update: nodes.filter((node) => node.state === 'update').length,
  }
}

function nest(roots: Node[], childrenOf: (node: Node) => Node[]): TreeItem[] {
  return roots.map((node) => ({ node, children: nest(childrenOf(node), childrenOf) }))
}

/** Category › Part › its records and stock; a stock item names its location on its row. */
export function categoryTree(nodes: Node[]): TreeItem[] {
  const places = new Map(
    nodes.filter((node) => node.kind === 'location').map((node) => [node.key, node.label]),
  )
  const shown = nodes
    .filter((node) => node.kind !== 'company' && node.kind !== 'location')
    .map((node) =>
      node.kind === 'stock_item' && node.state !== 'not_ticked'
        ? {
            ...node,
            label: `${node.label} · ${(node.location_key && places.get(node.location_key)) || 'No location'}`,
          }
        : node,
    )
  const keys = new Set(shown.map((node) => node.key))
  return nest(
    shown.filter((node) => node.parent_key === null || !keys.has(node.parent_key)),
    (parent) => shown.filter((node) => node.parent_key === parent.key),
  )
}

const NO_LOCATION: Node = {
  key: 'location:none',
  kind: 'location',
  label: 'No location',
  state: 'exists',
  parent_key: null,
  location_key: null,
  lot_id: null,
  part_subject_id: null,
  detail: null,
}

/** Location › stock item › its attachments. */
export function locationTree(nodes: Node[]): TreeItem[] {
  // A lot left out goes to no location, so grouping by location leaves it to the category tree.
  const stock = nodes.filter((node) => node.kind === 'stock_item' && node.state !== 'not_ticked')
  const roots = nodes.filter((node) => node.kind === 'location')
  const known = new Set(roots.map((node) => node.key))
  if (stock.some((node) => node.location_key === null || !known.has(node.location_key))) {
    roots.push(NO_LOCATION)
  }
  const keys = new Set(roots.map((node) => node.key))

  const placed = (node: Node) =>
    node.location_key !== null && keys.has(node.location_key) ? node.location_key : NO_LOCATION.key

  return nest(roots, (parent) =>
    parent.kind === 'location'
      ? stock.filter((node) => placed(node) === parent.key)
      : nodes.filter((node) => node.parent_key === parent.key && node.kind === 'attachment'),
  )
}

export function flatten(items: TreeItem[]): Node[] {
  return items.flatMap((item) => [item.node, ...flatten(item.children)])
}

const APPROVED = 'original_contribution_already_approved'

/** Reviewed lots with nothing to fix, not yet added. */
export function readyLotIds(workspace: Pick<ManualWorkspaceDto, 'lots'>) {
  return workspace.lots
    .filter((lot) => lot.reviewed && lot.issues.length === 0)
    .map((lot) => lot.lot_id)
}

/** Lots not ready to add, with the Review filter that shows why; added lots are in Added. */
export type LeftOutLot = { lotId: string; reason: string; filter: ReviewFilter }

/** The Review filter that lists a lot with this issue; others open the lot under All. */
const ISSUE_FILTERS: Record<string, ReviewFilter> = {
  part_choice_required: 'blocking',
  quantity_required: 'blocking',
  location_required: 'blocking',
  location_conflict: 'blocking',
  location_groups_unavailable: 'blocking',
  location_draft_parent_invalid: 'blocking',
  warning_unresolved: 'warnings',
  changed_after_review: 'changed',
  lot_excluded: 'excluded',
}

export function leftOutLots(workspace: Pick<ManualWorkspaceDto, 'lots'>): LeftOutLot[] {
  return workspace.lots.flatMap((lot): LeftOutLot[] => {
    if (lot.issues.some((issue) => issue.code === APPROVED)) {
      return []
    }
    if (lot.issues.length > 0) {
      const issue = lot.issues[0]
      return [
        { lotId: lot.lot_id, reason: issue.message, filter: ISSUE_FILTERS[issue.code] ?? 'all' },
      ]
    }
    return lot.reviewed
      ? []
      : [{ lotId: lot.lot_id, reason: 'Not reviewed', filter: 'needs_review' }]
  })
}

/**
 * What the preview alone shows (stock items, their Parts and locations) while the tree is read,
 * or where it is unavailable; the tree adds the catalogue records.
 */
export function previewNodes(preview: ManualPreviewDto): Node[] {
  const nodes = new Map<string, Node>()

  const add = (
    node: Omit<Node, 'parent_key' | 'location_key' | 'lot_id' | 'part_subject_id' | 'detail'> &
      Partial<Node>,
  ) => {
    if (!nodes.has(node.key)) {
      nodes.set(node.key, {
        parent_key: null,
        location_key: null,
        lot_id: null,
        part_subject_id: null,
        detail: null,
        ...node,
      })
    }
  }

  for (const effect of preview.effects) {
    const part =
      effect.part_id === null ? `part:op:${effect.part_operation_key}` : `part:pk:${effect.part_id}`
    const location =
      effect.location_id !== null
        ? `location:${effect.location_id}`
        : effect.location_operation_key
          ? `location:op:${effect.location_operation_key}`
          : null
    add({
      key: part,
      kind: 'part',
      label: effect.part_label,
      state: effect.part_id === null ? 'new' : 'exists',
    })
    if (location) {
      add({
        key: location,
        kind: 'location',
        label: effect.location_label,
        state: effect.location_id === null ? 'new' : 'exists',
      })
    }
    add({
      key: `stock:${effect.lot_id}`,
      kind: 'stock_item',
      label: `${effect.lot_label} · ${effect.quantity}`,
      state: 'new',
      parent_key: part,
      location_key: location,
      lot_id: effect.lot_id,
    })
  }
  return [...nodes.values()]
}

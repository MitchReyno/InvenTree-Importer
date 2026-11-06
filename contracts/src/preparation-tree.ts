import { Type, type Static } from '@sinclair/typebox'
import { Id } from './scalars.ts'
import { object } from './capture-primitives.ts'

const choice = <const T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)))

export const PREPARATION_NODE_KINDS = [
  'category',
  'company',
  'part',
  'manufacturer_part',
  'supplier_part',
  'parameter',
  'location',
  'stock_item',
  'attachment',
] as const

/**
 * One record a preparation creates or uses. `parent_key` places it under its category, Part or
 * stock item; `location_key` places a stock item under its location. Both views read this list.
 */
export const PreparationNode = object({
  key: Type.String({ minLength: 1, maxLength: 160 }),
  kind: choice(PREPARATION_NODE_KINDS),
  label: Type.String({ minLength: 1, maxLength: 512 }),
  state: choice(['new', 'update', 'exists', 'choose'] as const),
  parent_key: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
  location_key: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
  /** The lot a stock item or its attachment comes from, for its link into Review. */
  lot_id: Type.Union([Id, Type.Null()]),
  /** The batch Part a node belongs to, for its link to the record in Review. */
  part_subject_id: Type.Union([Id, Type.Null()]),
})

/** Read from the stored plan; `nodes` is null for a plan version this build cannot place. */
export const PreparationTree = object({
  preparation_id: Id,
  plan_version: Type.String({ minLength: 1, maxLength: 64 }),
  nodes: Type.Union([Type.Array(PreparationNode, { maxItems: 2000 }), Type.Null()]),
})

export const preparationTreeSchemas = { PreparationNode, PreparationTree }

export type PreparationNodeDto = Static<typeof PreparationNode>
export type PreparationNodeKind = (typeof PREPARATION_NODE_KINDS)[number]
export type PreparationTreeDto = Static<typeof PreparationTree>

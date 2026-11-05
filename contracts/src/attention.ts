import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, Revision } from './scalars.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const choice = <const T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)))

const count = Type.Integer({ minimum: 0, maximum: 100000 })

/** Bounds the panel; counts stay exact when items are truncated. */
export const MAX_ATTENTION_ITEMS = 200

export const AttentionGroup = choice(['question', 'changed_lot', 'decision', 'result'])

export const AttentionTab = choice(['processing', 'review', 'changes'])

/** One open thing in the batch, linked to the screen that owns it. */
export const AttentionItem = object({
  key: Type.String({ minLength: 1, maxLength: 128 }),
  group: AttentionGroup,
  tab: AttentionTab,
  title: Type.String({ minLength: 1, maxLength: 2048 }),
  detail: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  /** An in-app hash route under the batch, without the leading `#`. */
  route: Type.String({
    maxLength: 512,
    pattern: '^[0-9a-f-]{36}/(processing|review|changes)(/[A-Za-z0-9_-]+)*$',
  }),
})

/** Tab counts and need-you items from one read, so badges and the panel always agree. */
export const BatchAttention = object({
  batch_id: Id,
  revision: Revision,
  processing: object({ questions: count }),
  review: object({ to_check: count, changed_after_review: count, to_decide: count }),
  changes: object({ ready: count, failed: count, uncertain: count }),
  items: Type.Array(AttentionItem, { maxItems: MAX_ATTENTION_ITEMS }),
  items_truncated: Type.Boolean(),
})

export const attentionSchemas = { AttentionItem, BatchAttention }

export type AttentionItemDto = Static<typeof AttentionItem>
export type BatchAttentionDto = Static<typeof BatchAttention>

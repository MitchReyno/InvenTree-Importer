import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, PositivePk, Digest } from './scalars.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const text = Type.String({ minLength: 1, maxLength: 256 })
export const InventoryModel = Type.Union(
  (
    ['part', 'location', 'category', 'parameter_template', 'category_parameter', 'company'] as const
  ).map((value) => Type.Literal(value)),
)

export const mappedReference = <
  M extends 'category' | 'parameter_template' | 'category_parameter' | 'company',
>(
  model: M,
) =>
  object({ observation_id: Id, target_context_id: Id, model: Type.Literal(model), pk: PositivePk })

export const InventoryPartSpec = object({
  name: text,
  category: mappedReference('category'),
  parameters: Type.Array(
    object({
      template: mappedReference('parameter_template'),
      category_mapping: mappedReference('category_parameter'),
      value: text,
    }),
    { maxItems: 32 },
  ),
  manufacturer: Type.Union([
    Type.Null(),
    object({ company: mappedReference('company'), mpn: text }),
  ]),
  supplier: Type.Union([Type.Null(), object({ company: mappedReference('company'), sku: text })]),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 100, pattern: '[^\\s]' }), {
    maxItems: 32,
    uniqueItems: true,
  }),
})
export const InventoryMapping = Type.Union([
  object({ kind: Type.Literal('category') }),
  object({
    kind: Type.Literal('parameter_template'),
    model_type: Type.Union([Type.Literal('part.part'), Type.Null()]),
    enabled: Type.Boolean(),
  }),
  object({
    kind: Type.Literal('category_parameter'),
    category_id: PositivePk,
    template_id: PositivePk,
  }),
  object({ kind: Type.Literal('company'), manufacturer: Type.Boolean(), supplier: Type.Boolean() }),
])
export const SupportedEffectKind = Type.Union(
  (
    [
      'create_stock',
      'create_part',
      'parameter',
      'manufacturer',
      'supplier',
      'part_attachment',
    ] as const
  ).map((value) => Type.Literal(value)),
)
export const SupportedEffectPreview = object({
  operation_key: Id,
  part_subject_id: Id,
  kind: SupportedEffectKind,
  label: text,
  dependencies: Type.Array(Id, { maxItems: 32, uniqueItems: true }),
  inputs: Type.Record(Type.String({ maxLength: 64 }), Type.String({ maxLength: 256 }), {
    maxProperties: 16,
  }),
})
export const PartOutput = object({
  label: text,
  operation_key: Id,
  part_subject_id: Id,
  spec_sha256: Digest,
  certainty: Type.Union([Type.Literal('none'), Type.Literal('unknown'), Type.Literal('confirmed')]),
  remote_pks: Type.Array(PositivePk, { uniqueItems: true }),
  usable: Type.Boolean(),
  verification: Type.Union([
    Type.Null(),
    Type.Literal('matches'),
    Type.Literal('missing_or_changed'),
    Type.Literal('unavailable'),
  ]),
})
export const SupportedEffectResult = object({
  ...SupportedEffectPreview.properties,
  certainty: Type.Union([Type.Literal('none'), Type.Literal('unknown'), Type.Literal('confirmed')]),
  remote_pks: Type.Array(PositivePk, { uniqueItems: true }),
  verification: Type.Union([
    Type.Null(),
    Type.Literal('matches'),
    Type.Literal('missing_or_changed'),
    Type.Literal('unavailable'),
  ]),
  recovery_action: Type.Union([
    Type.Null(),
    Type.Literal('resume_effect'),
    Type.Literal('verify_effect'),
  ]),
})
export const effectsSchemas = {
  InventoryModel,
  InventoryPartSpec,
  InventoryMapping,
  SupportedEffectKind,
  SupportedEffectPreview,
  PartOutput,
  SupportedEffectResult,
}
export type InventoryPartSpecDto = Static<typeof InventoryPartSpec>
export type InventoryMappingDto = Static<typeof InventoryMapping>
export type InventoryModelDto = Static<typeof InventoryModel>
export type SupportedEffectPreviewDto = Static<typeof SupportedEffectPreview>
export type SupportedEffectResultDto = Static<typeof SupportedEffectResult>
export type PartOutputDto = Static<typeof PartOutput>

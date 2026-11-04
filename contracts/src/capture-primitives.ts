import { Type, type TProperties, type TSchema } from '@sinclair/typebox'
import { Id, PositivePk } from './scalars.ts'

/** Shared capture schema building blocks, kept separate so capture modules avoid import cycles. */
export const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

export const label = Type.String({ minLength: 1, maxLength: 256 })
export const note = Type.String({ maxLength: 8192 })
export const CaptureRef = object({
  observation_id: Id,
  target_context_id: Id,
  model: Type.Union([Type.Literal('part'), Type.Literal('location')]),
  pk: PositivePk,
})

export const selection = <T extends TSchema>(value: T) =>
  Type.Union([
    object({ mode: Type.Literal('unset') }),
    object({ mode: Type.Literal('unknown') }),
    object({ mode: Type.Literal('clear') }),
    object({ mode: Type.Literal('set'), value }),
  ])

export const inheritable = <T extends TSchema>(value: T) =>
  Type.Union([...selection(value).anyOf, object({ mode: Type.Literal('inherit') })])

export const calendarDate = Type.String({
  pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}(?![\\s\\S])',
})
export const captureTags = Type.Array(
  Type.String({ minLength: 1, maxLength: 100, pattern: '[^\\s]' }),
  { maxItems: 32, uniqueItems: true },
)

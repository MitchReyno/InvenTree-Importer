import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, PositivePk } from './scalars.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/** A saved default record, checked against InvenTree on read; absence from a list proves nothing. */
export const BatchDefaultRecord = object({
  pk: PositivePk,
  /** The record's name when it was found; null otherwise. */
  label: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  status: Type.Union([
    Type.Literal('found'),
    Type.Literal('not_found'),
    Type.Literal('unavailable'),
  ]),
})
/** App-level values copied into each new batch at creation. */
export const BatchDefaults = object({
  revision: CursorSequence,
  location: Type.Union([BatchDefaultRecord, Type.Null()]),
  supplier: Type.Union([BatchDefaultRecord, Type.Null()]),
})
export const BatchDefaultsUpdate = object({
  expected_revision: CursorSequence,
  location_pk: Type.Union([PositivePk, Type.Null()]),
  supplier_pk: Type.Union([PositivePk, Type.Null()]),
})
/** A default a new batch could not copy, and why. */
export const CaptureCreationNotice = object({
  field: Type.Union([Type.Literal('location'), Type.Literal('supplier')]),
  code: Type.Union([Type.Literal('default_not_found'), Type.Literal('default_unavailable')]),
})

export const batchDefaultsSchemas = {
  BatchDefaultRecord,
  BatchDefaults,
  BatchDefaultsUpdate,
  CaptureCreationNotice,
}
export type BatchDefaultRecordDto = Static<typeof BatchDefaultRecord>
export type BatchDefaultsDto = Static<typeof BatchDefaults>
export type BatchDefaultsUpdateDto = Static<typeof BatchDefaultsUpdate>
export type CaptureCreationNoticeDto = Static<typeof CaptureCreationNotice>

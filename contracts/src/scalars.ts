import { Type } from '@sinclair/typebox'

const end = '(?![\\s\\S])'
export const Id = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' + end })
export const Revision = Type.String({ pattern: '^[1-9][0-9]{0,18}' + end, format: 'int64' })
export const CursorSequence = Type.String({ pattern: '^(0|[1-9][0-9]{0,18})' + end, format: 'int64' })
export const Digest = Type.String({ pattern: '^[0-9a-f]{64}' + end })
export const PositivePk = Type.String({ pattern: '^[1-9][0-9]{0,18}' + end, format: 'int64' })
export const Quantity = Type.String({ pattern: '^(?=.*[1-9])(0|[1-9][0-9]{0,12})(\\.[0-9]{0,5}[1-9])?' + end })

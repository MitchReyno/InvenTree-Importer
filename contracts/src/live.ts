import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Digest, Id } from './scalars.ts'

export const LIVE_PROTOCOL = 'bench-intake-live/1' as const
export const LIVE_MAX_STREAMS = 100
export const LIVE_REPLAY_WINDOW = 128

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const protocol = Type.Literal(LIVE_PROTOCOL)
export const LiveCursor = object({ stream_id: Id, sequence: CursorSequence })
const cursors = Type.Array(LiveCursor, { maxItems: LIVE_MAX_STREAMS, uniqueItems: true })
export const LiveSubscribe = object({
  type: Type.Literal('subscribe'),
  protocol,
  csrf_token: Digest,
  batch_id: Type.Union([Id, Type.Null()]),
  cursors,
})
export const LiveFrame = Type.Union([
  object({ type: Type.Literal('ready'), protocol, cursors, truncated: Type.Boolean() }),
  object({
    type: Type.Literal('changed'),
    protocol,
    batch_id: Id,
    stream_id: Id,
    sequence: CursorSequence,
    reset: Type.Boolean(),
  }),
  object({ type: Type.Literal('heartbeat'), protocol }),
])
export const Readiness = object({
  status: Type.Literal('ready'),
  api_version: Type.Literal('bench-intake-app/1'),
  deployment: Type.Literal('restricted-local-development'),
  identity: Type.Literal('deferred_T11'),
  research: Type.Literal('unqualified'),
  media: Type.Union([Type.Literal('configured'), Type.Literal('disabled')]),
  updates: Type.Literal('websocket-with-polling-fallback'),
  apply: Type.Literal('separately-supervised-owned-fake-only'),
})
export const liveSchemas = { LiveCursor, LiveSubscribe, LiveFrame, Readiness }
export type LiveCursorDto = Static<typeof LiveCursor>
export type LiveSubscribeDto = Static<typeof LiveSubscribe>
export type LiveFrameDto = Static<typeof LiveFrame>

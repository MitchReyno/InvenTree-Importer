import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chatHandled,
  type QualificationTrace,
} from '../scripts/native-session-qualification/chat.ts'

const session = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const chat = {
  id: '20000000-0000-4000-8000-000000000001',
  session_id: session,
  created_at: '2026-11-07T10:00:00.000Z',
  text: 'The supplier says this is a 5000-piece reel, not 500.',
}
const question = '30000000-0000-4000-8000-000000000001'

function trace(outbox: QualificationTrace['outbox'], readAt?: string): QualificationTrace {
  return {
    chat,
    readAt,
    outbox,
    questions: {
      [question]: {
        prompt: 'How many LEDs are on the reel?',
        reason: 'The photo label says 500 pcs but the chat says 5000.',
        assumption: 'I keep 500 until you confirm.',
      },
    },
  }
}
const at = (seconds: number) => new Date(Date.parse(chat.created_at) + seconds * 1000).toISOString()

test('a reply that names the chat handles it', () => {
  const result = chatHandled(
    trace([
      {
        session_id: session,
        created_at: at(3),
        kind: 'reply',
        payload: { inbox_item_id: chat.id, text: 'Noted.' },
      },
    ]),
  )
  assert.deepEqual(result, { handled: true, by: 'reply' })
})

test('a question or status about the read chat handles it', () => {
  assert.deepEqual(
    chatHandled(
      trace(
        [
          {
            session_id: session,
            created_at: at(6),
            kind: 'question',
            payload: { question_id: question },
          },
        ],
        at(4),
      ),
    ),
    { handled: true, by: 'question', matched: ['500', '5000', 'reel', 'says'] },
  )
  assert.deepEqual(
    chatHandled(
      trace(
        [
          {
            session_id: session,
            created_at: at(5),
            kind: 'status',
            payload: { text: "Checking the supplier's 5000-piece reel against the label" },
          },
        ],
        at(4),
      ),
    ),
    { handled: true, by: 'status', matched: ['5000', 'piece', 'reel', 'supplier'] },
  )
})

test('unrelated activity never counts as handling the chat', () => {
  const unrelated: QualificationTrace['outbox'] = [
    // Before the chat existed: these words are the session's own, not the chat's.
    {
      session_id: session,
      created_at: at(-8),
      kind: 'status',
      payload: { text: 'Reel close-up shows 500 pcs' },
    },
    // Same-component progress after reading, using only words the session already used.
    {
      session_id: session,
      created_at: at(7),
      kind: 'status',
      payload: { text: 'Reel label still shows 500 pcs' },
    },
    // Before the chat existed, even though it mentions the reel.
    {
      session_id: session,
      created_at: at(-5),
      kind: 'status',
      payload: { text: 'Reading the reel label' },
    },
    // Sent but not yet read.
    {
      session_id: session,
      created_at: at(2),
      kind: 'status',
      payload: { text: 'Reel count 5000?' },
    },
    // Read, but the status is about something else.
    {
      session_id: session,
      created_at: at(8),
      kind: 'status',
      payload: { text: 'Fetching photo 2' },
    },
    // Ordinary progress items.
    {
      session_id: session,
      created_at: at(9),
      kind: 'observation',
      payload: { evidence_observation_id: question },
    },
    {
      session_id: session,
      created_at: at(9),
      kind: 'proposal',
      payload: { proposal_id: question },
    },
    // A reply to a different inbox item.
    {
      session_id: session,
      created_at: at(10),
      kind: 'reply',
      payload: { inbox_item_id: question, text: 'About the 5000-piece reel' },
    },
    // A relevant question from another session.
    { session_id: other, created_at: at(11), kind: 'question', payload: { question_id: question } },
  ]
  assert.deepEqual(chatHandled(trace(unrelated, at(4))), { handled: false })
})

test('a number alone does not show the chat was taken up', () => {
  assert.deepEqual(
    chatHandled(
      trace(
        [
          {
            session_id: session,
            created_at: at(6),
            kind: 'status',
            payload: { text: 'Photo shows 500 pcs' },
          },
        ],
        at(4),
      ),
    ),
    { handled: 'unverified', by: 'status', matched: ['500'] },
  )
})

test('without an observed read time, a question or status is unverified', () => {
  assert.deepEqual(
    chatHandled(
      trace([
        {
          session_id: session,
          created_at: at(-1),
          kind: 'question',
          payload: { question_id: question },
        },
      ]),
    ),
    { handled: false },
  )
  assert.deepEqual(
    chatHandled(
      trace([
        {
          session_id: session,
          created_at: at(1),
          kind: 'question',
          payload: { question_id: question },
        },
      ]),
    ),
    { handled: 'unverified', by: 'question', matched: ['500', '5000', 'reel', 'says'] },
  )
})

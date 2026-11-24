import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, type SessionHistoryDto, type SessionHistoryEntryDto } from '@invimport/contracts'
import {
  readSessionTrace,
  retainedChatTime,
} from '../scripts/native-session-qualification/trace.ts'

const job = '30000000-0000-4000-8000-000000000003'
const first = '40000000-0000-4000-8000-000000000004'
const second = '40000000-0000-4000-8000-000000000044'
const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 2, minute)).toISOString()

function attempt(id: string, number: number) {
  return {
    id,
    number,
    state: 'running' as const,
    session_state: 'running' as const,
    queued_at: at(number),
    started_because: null,
    profile_id: 'synthetic-session/1',
    runs_on: 'fixture' as const,
    selection: null,
    actual_model: null,
    web: null,
  }
}

function status(
  attemptId: string,
  number: number,
  seq: number,
  minute: number,
): SessionHistoryEntryDto {
  return {
    id: `outbox:${attemptId}:${seq}`,
    at: at(minute),
    who: 'agent',
    attempt: number,
    summary: `status ${number}.${seq}`,
    links: [],
    details: { kind: 'status', text: `status ${number}.${seq}` },
  }
}

function page(entries: SessionHistoryEntryDto[], before?: string): SessionHistoryDto {
  const value: SessionHistoryDto = {
    session: {
      job_id: job,
      batch_id: '10000000-0000-4000-8000-000000000001',
      stage: 'research',
      subject_id: null,
      current_attempt_id: second,
      attempts: [attempt(second, 2), attempt(first, 1)],
      inbox_acked_seq: '0',
      start_fresh: { allowed: false, reason: 'session_not_replaceable' },
    },
    entries,
    ...(before ? { before } : {}),
  }
  validate('SessionHistory', value)
  return value
}

test('the qualification trace follows the history cursor and keeps each attempt’s items apart', async () => {
  const newest = page(
    [
      status(second, 2, 1, 9),
      {
        id: 'inbox:4',
        at: at(8),
        who: 'operator',
        read: true,
        summary: 'Now check the count',
        links: [],
        details: { kind: 'chat', text: 'Now check the count' },
      },
      status(first, 1, 2, 5),
    ],
    'older',
  )
  const older = page([
    {
      id: 'inbox:3',
      at: at(4),
      who: 'operator',
      read: true,
      summary: 'Check the label',
      links: [],
      details: { kind: 'chat', text: 'Check the label' },
    },
    status(first, 1, 1, 3),
  ])
  const reads: (string | undefined)[] = []
  const trace = await readSessionTrace(async (before) => {
    reads.push(before)
    return before === 'older' ? older : newest
  })

  assert.deepEqual(reads, [undefined, 'older'])
  // Oldest first, with sequence 1 of each attempt kept apart by its attempt.
  assert.deepEqual(
    trace.outbox.map((item) => [item.session_id, item.created_at]),
    [
      [first, at(3)],
      [first, at(5)],
      [second, at(9)],
    ],
  )
  // A chat receipt's sequence names its entry, on whichever page holds it.
  assert.deepEqual(
    trace.inbox.map((item) => item.seq),
    ['3', '4'],
  )
  assert.equal(retainedChatTime(trace, '3'), at(4))
  assert.equal(retainedChatTime(trace, '4'), at(8))
  assert.equal(retainedChatTime(trace, '9'), undefined)
})

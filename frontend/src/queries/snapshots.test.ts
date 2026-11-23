import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  validate,
  type BatchRecordsDto,
  type CaptureSnapshotDto,
  type ManualWorkspaceDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import type { ServerScope } from './scope'
import { SNAPSHOT_MAX_AGE_MS, SNAPSHOT_WRITE_INTERVAL_MS, SnapshotStore } from './snapshots'

const batchId = '10000000-0000-4000-8000-000000000001'
const scope: ServerScope = {
  origin: 'http://127.0.0.1:4310',
  actorId: '60000000-0000-4000-8000-000000000006',
  targetId: '70000000-0000-4000-8000-000000000007',
  targetContextId: '80000000-0000-4000-8000-000000000008',
}
const otherTarget: ServerScope = { ...scope, targetId: '70000000-0000-4000-8000-0000000000ff' }
const cursor = { stream_id: 'b0000000-0000-4000-8000-000000000002', sequence: '8' }
/** Values that must never reach storage. */
const SENTINEL_ID = 'dead0000-0000-4000-8000-00000000beef'
const SENTINEL_TEXT = 'sentinel-secret-text'

const capture: CaptureSnapshotDto = {
  id: batchId,
  source_id: '90000000-0000-4000-8000-000000000009',
  title: 'Packet questions',
  revision: '8',
  archived: false,
  updated_at: '2026-11-02T00:00:00Z',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [],
  notes: [],
  observations: [],
  lots: [
    {
      id: '20000000-0000-4000-8000-000000000002',
      label: 'Packet A',
      revision: '3',
      contribution_key: 'a0000000-0000-4000-8000-000000000001',
      part_subject_id: null,
      quantity: { mode: 'inherit' },
      location: { mode: 'inherit' },
      origin: 'agent',
      agent_session_id: SENTINEL_ID,
    },
  ],
  cursor,
}
const processing: ProcessingSnapshotDto = {
  batch_id: batchId,
  capture_revision: '8',
  runner_status: 'fixture_only',
  cursor,
  jobs: [],
  paused: true,
}
const workspace: ManualWorkspaceDto = {
  batch_id: batchId,
  revision: '8',
  supported: true,
  capability: null,
  lots: [],
  runs: [],
  preparations: [],
  preparations_truncated: false,
  cursor,
}
const records: BatchRecordsDto = { batch_id: batchId, revision: '8', counts: [], records: [] }

let storage: Storage
let now: number

function store(build = 'build-1') {
  return new SnapshotStore({ storage: () => storage, now: () => now, build })
}

/** Every stored value, as text, to look for what must not be there. */
function storedText() {
  return Object.keys(storage)
    .map((key) => `${key}=${storage.getItem(key)}`)
    .join('\n')
}

beforeEach(() => {
  storage = window.sessionStorage
  storage.clear()
  now = Date.parse('2026-11-24T09:00:00Z')
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  storage.clear()
})

test('the fixtures are valid reads', () => {
  for (const [schema, value] of [
    ['CaptureSnapshot', capture],
    ['ProcessingSnapshot', processing],
    ['ManualWorkspace', workspace],
    ['BatchRecords', records],
  ] as const) {
    expect(() => validate(schema, value)).not.toThrow()
  }
})

test('each allowlisted read round-trips through its projection', () => {
  const snapshots = store()
  snapshots.write('processing', scope, batchId, processing)
  snapshots.write('review-workspace', scope, batchId, workspace)
  snapshots.write('batch', scope, batchId, capture)
  snapshots.write('records', scope, batchId, records)

  expect(snapshots.read('processing', scope, batchId)).toEqual(processing)
  expect(snapshots.read('review-workspace', scope, batchId)).toEqual(workspace)
  expect(snapshots.read('records', scope, batchId)).toEqual(records)
  const { agent_session_id: _session, ...lot } = capture.lots[0]
  expect(snapshots.read('batch', scope, batchId)).toEqual({ ...capture, lots: [lot] })
})

test('sentinels in excluded fields, keys and nested DTOs never reach session storage', () => {
  const snapshots = store()
  const withSecrets = {
    ...capture,
    settings_intent: { secret: SENTINEL_TEXT },
    setting_notes: [{ text: SENTINEL_TEXT }],
    reference_drafts: [{ text: SENTINEL_TEXT }],
    creation_notices: [{ text: SENTINEL_TEXT }],
    context: [{ text: SENTINEL_TEXT }],
    [SENTINEL_TEXT]: SENTINEL_TEXT,
  } as unknown as CaptureSnapshotDto
  snapshots.write('batch', scope, batchId, withSecrets)
  snapshots.write('processing', scope, batchId, {
    ...processing,
    jobs: [
      {
        id: '30000000-0000-4000-8000-000000000003',
        subject_id: null,
        stage: 'research',
        revision: '1',
        state: 'running',
        attempt_id: SENTINEL_ID,
        input_sha256: 'a'.repeat(64),
        attempt_number: '1',
        qualification: 'fixture_only',
        proposals: [],
        questions: [],
      },
    ],
    csrf_token: SENTINEL_TEXT,
  } as unknown as ProcessingSnapshotDto)
  now += SNAPSHOT_WRITE_INTERVAL_MS
  snapshots.write('review-workspace', scope, batchId, {
    ...workspace,
    preparations: [{ id: SENTINEL_ID, plan: SENTINEL_TEXT }],
    runs: [{ run_id: SENTINEL_ID }],
  } as unknown as ManualWorkspaceDto)
  snapshots.write('records', scope, batchId, {
    ...records,
    existing: SENTINEL_TEXT,
  } as unknown as BatchRecordsDto)

  const text = storedText()
  expect(text).toContain('bench-intake.snapshot.processing')
  expect(text).toContain('bench-intake.snapshot.batch')
  expect(text).toContain('bench-intake.snapshot.review-workspace')
  expect(text).not.toContain(SENTINEL_TEXT)
  expect(text).not.toContain(SENTINEL_ID)
  expect(text).not.toMatch(/csrf|token|credential/i)
})

test('a stored entry that fails validation, or is not an entry, reads as nothing', () => {
  const snapshots = store()
  snapshots.write('processing', scope, batchId, processing)
  const key = Object.keys(storage)[0]
  const entry = JSON.parse(storage.getItem(key)!)
  storage.setItem(key, JSON.stringify({ ...entry, data: { ...processing, jobs: 'tampered' } }))
  expect(snapshots.read('processing', scope, batchId)).toBeUndefined()

  storage.setItem(key, 'not json')
  expect(snapshots.read('processing', scope, batchId)).toBeUndefined()
  snapshots.prune(scope)
  expect(storage.getItem(key)).toBeNull()
})

test('a snapshot shows only for its own scope, and another scope’s are deleted unread', () => {
  const snapshots = store()
  snapshots.write('processing', scope, batchId, processing)

  expect(snapshots.read('processing', otherTarget, batchId)).toBeUndefined()
  snapshots.prune(otherTarget)
  expect(storedText()).toBe('')
})

test('snapshots expire after 12 hours and with another build', () => {
  store('build-1').write('processing', scope, batchId, processing)
  expect(store('build-2').read('processing', scope, batchId)).toBeUndefined()

  now += SNAPSHOT_MAX_AGE_MS
  expect(store('build-1').read('processing', scope, batchId)).toEqual(processing)
  now += 1
  expect(store('build-1').read('processing', scope, batchId)).toBeUndefined()
  store('build-1').prune(scope)
  expect(storedText()).toBe('')
})

test('writes are throttled to one per resource per second, keeping the newest', () => {
  const snapshots = store()
  snapshots.write('processing', scope, batchId, processing)
  snapshots.write('processing', scope, batchId, { ...processing, capture_revision: '9' })
  snapshots.write('processing', scope, batchId, { ...processing, capture_revision: '10' })
  expect(snapshots.read('processing', scope, batchId)?.capture_revision).toBe('8')

  now += SNAPSHOT_WRITE_INTERVAL_MS
  vi.advanceTimersByTime(SNAPSHOT_WRITE_INTERVAL_MS)
  expect(snapshots.read('processing', scope, batchId)?.capture_revision).toBe('10')
})

test('a scope change drops the old scope’s waiting writes, and the new scope deletes its snapshots', () => {
  const snapshots = store()
  snapshots.write('processing', scope, batchId, processing)
  snapshots.write('processing', scope, batchId, { ...processing, capture_revision: '9' })

  snapshots.dropPendingWrites(scope)
  now += SNAPSHOT_WRITE_INTERVAL_MS
  vi.advanceTimersByTime(SNAPSHOT_WRITE_INTERVAL_MS)
  expect(snapshots.read('processing', scope, batchId)?.capture_revision).toBe('8')

  snapshots.prune(otherTarget)
  expect(snapshots.read('processing', scope, batchId)).toBeUndefined()
  expect(storedText()).toBe('')
})

test('a projection over the size cap is not stored and removes the older one', () => {
  const snapshots = new SnapshotStore({
    storage: () => storage,
    now: () => now,
    build: 'build-1',
    maxBytes: 1024,
  })
  snapshots.write('processing', scope, batchId, processing)
  expect(snapshots.read('processing', scope, batchId)).toEqual(processing)

  const oversized: ProcessingSnapshotDto = {
    ...processing,
    jobs: Array.from({ length: 20 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      subject_id: null,
      stage: 'research',
      revision: '1',
      state: 'running',
      attempt_id: '40000000-0000-4000-8000-000000000004',
      input_sha256: 'a'.repeat(64),
      attempt_number: '1',
      qualification: 'fixture_only',
      proposals: [],
      questions: [],
    })),
  }
  now += SNAPSHOT_WRITE_INTERVAL_MS
  snapshots.write('processing', scope, batchId, oversized)
  expect(snapshots.read('processing', scope, batchId)).toBeUndefined()
})

test('a full storage clears every snapshot and is reported for debug only', () => {
  const snapshots = store()
  snapshots.write('records', scope, batchId, records)
  const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError')
  })
  try {
    snapshots.write('processing', scope, batchId, processing)
  } finally {
    full.mockRestore()
  }
  expect(storedText()).toBe('')
  expect(snapshots.lastFailure()).toBe('Session storage full; snapshots cleared')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeSubjectJobs, countStageWork, countSteps, liveLotIds } from '#/processing/steps.ts'

const lot = '00000000-0000-4000-8000-000000000101'
const retired = '00000000-0000-4000-8000-000000000102'
const part = '00000000-0000-4000-8000-000000000103'

test('step counts keep the lead job, active lots and parts, and leave out retired lots', () => {
  const jobs = [
    { subject_id: null, stage: 'examine', state: 'ready' },
    { subject_id: lot, stage: 'research', state: 'ready' },
    { subject_id: retired, stage: 'research', state: 'superseded' },
    { subject_id: part, stage: 'research', state: 'failed' },
  ]

  const active = activeSubjectJobs(jobs, new Set([retired]))

  assert.deepEqual(
    active.map((job) => job.subject_id),
    [null, lot, part],
  )
  assert.deepEqual(countSteps(active).research, { jobs: 2, ready: 1, running: 0 })
})

test('stage work counts waiting, queued, failed and open questions, and ready lots only for live lots', () => {
  const live = new Set([lot])
  const jobs = [
    { subject_id: lot, stage: 'research', state: 'ready', questions: [] },
    { subject_id: lot, stage: 'images', state: 'waiting_for_user', questions: [{ state: 'open' }] },
    { subject_id: part, stage: 'research', state: 'ready', questions: [] },
    { subject_id: part, stage: 'images', state: 'interrupted', questions: [{ state: 'answered' }] },
    { subject_id: lot, stage: 'inventory', state: 'waiting_for_capacity', questions: [] },
    { subject_id: null, stage: 'examine', state: 'waiting_for_login', questions: [] },
  ]

  const work = countStageWork(jobs, live)

  assert.deepEqual(work.research, {
    jobs: 2,
    ready: 2,
    running: 0,
    waiting: 0,
    queued: 0,
    questions: 0,
    failed: 0,
    ready_lots: 1,
  })
  assert.deepEqual(work.images, {
    jobs: 2,
    ready: 0,
    running: 0,
    waiting: 1,
    queued: 0,
    questions: 1,
    failed: 1,
    ready_lots: 0,
  })
  assert.equal(work.inventory.queued, 1)
  assert.equal(work.examine.waiting, 1)
  assert.deepEqual([...liveLotIds({ lots: [{ id: lot }, { id: retired, retired: true }] })], [lot])
})

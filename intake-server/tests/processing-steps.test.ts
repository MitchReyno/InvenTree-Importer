import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeSubjectJobs, countSteps } from '#/processing/steps.ts'

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

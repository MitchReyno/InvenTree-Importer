import { describe, expect, it } from 'vitest'
import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { retainedJobsSource, subjectStatuses } from './source'

const digest = 'a'.repeat(64)

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const lot = id(90)

type Job = ProcessingSnapshotDto['jobs'][number]

function job(n: number, stage: string, state: string, extra: Partial<Job> = {}): Job {
  return {
    id: id(n),
    subject_id: lot,
    stage,
    revision: '1',
    state,
    attempt_id: id(n + 40),
    input_sha256: digest,
    attempt_number: '1',
    qualification: 'fixture_only',
    proposals: [],
    questions: [],
    ...extra,
  } as Job
}

function question(n: number, state: 'open' | 'answered', assumption?: string) {
  return {
    id: id(n),
    job_id: id(n),
    attempt_id: id(n),
    input_sha256: digest,
    revision: '1',
    state,
    spec: { kind: 'clarification', subject_id: lot, prompt: `Question ${n}?`, reason: 'Unclear' },
    ...(assumption ? { assumption } : {}),
  }
}

function snapshot(jobs: Job[]): ProcessingSnapshotDto {
  return {
    batch_id: id(99),
    capture_revision: '3',
    runner_status: 'fixture_only',
    cursor: { stream_id: id(98), sequence: '1' },
    jobs,
  } as ProcessingSnapshotDto
}

const subjects = new Map([[lot, 'Packet A']])
const lots = new Set([lot])

describe('retainedJobsSource', () => {
  it('maps every job kind to its step, with Reading and Identifying on Examine', () => {
    const source = retainedJobsSource(
      snapshot([
        job(1, 'reading', 'ready'),
        job(2, 'identifying', 'running'),
        job(3, 'examine', 'failed'),
        job(4, 'research', 'waiting_for_user'),
        job(5, 'images', 'queued'),
        job(6, 'inventory', 'interrupted'),
      ]),
      subjects,
      lots,
    )

    expect(source.jobsOn('examine').map((item) => item.id)).toEqual([id(1), id(2), id(3)])
    expect(source.jobsOn('research').map((item) => item.id)).toEqual([id(4)])
    expect(source.jobsOn('images').map((item) => item.id)).toEqual([id(5)])
    expect(source.jobsOn('inventory').map((item) => item.id)).toEqual([id(6)])
    expect(source.steps.find((step) => step.step === 'examine')).toMatchObject({
      jobs: 3,
      ready: 1,
      running: 1,
      failed: 1,
    })
    expect(source.steps.find((step) => step.step === 'research')).toMatchObject({ waiting: 1 })
    expect(source.steps.find((step) => step.step === 'inventory')).toMatchObject({ failed: 1 })
  })

  it('reports no sessions for the fixture profile', () => {
    const source = retainedJobsSource(snapshot([job(1, 'reading', 'running')]), subjects, lots)

    expect(source.sessions).toEqual([])
  })

  it('reports a session only for a job that has one, with its step and subject', () => {
    const source = retainedJobsSource(
      snapshot([
        job(1, 'research', 'running', { session_state: 'waiting_input' } as Partial<Job>),
        job(2, 'images', 'ready'),
      ]),
      subjects,
      lots,
    )

    expect(source.sessions).toEqual([
      {
        jobId: id(1),
        step: 'research',
        subject: 'Packet A',
        lotId: lot,
        state: 'waiting_input',
        status: null,
      },
    ])
  })

  it('carries each session’s latest status, the lead session, and each lot’s newest line', () => {
    const status = (text: string, at: string) => ({ latest_status: { text, at } }) as Partial<Job>

    const source = retainedJobsSource(
      snapshot([
        job(1, 'examine', 'running', {
          subject_id: null,
          session_state: 'running',
          ...status('Finding items in the photos', '2026-11-06T10:00:00.000Z'),
        } as Partial<Job>),
        job(2, 'research', 'running', {
          session_state: 'running',
          ...status('Checking the datasheet', '2026-11-06T10:02:00.000Z'),
        } as Partial<Job>),
        job(3, 'images', 'running', {
          session_state: 'waiting_input',
          ...status('Choosing the best photo', '2026-11-06T10:01:00.000Z'),
        } as Partial<Job>),
      ]),
      subjects,
      lots,
    )

    expect(source.lead).toMatchObject({ jobId: id(1), subject: 'Whole batch', lotId: null })
    expect(source.sessions.map((session) => session.status)).toEqual([
      'Finding items in the photos',
      'Checking the datasheet',
      'Choosing the best photo',
    ])
    const statuses = subjectStatuses(
      snapshot([
        job(2, 'research', 'running', {
          session_state: 'running',
          ...status('Checking the datasheet', '2026-11-06T10:02:00.000Z'),
        } as Partial<Job>),
        job(3, 'images', 'running', {
          session_state: 'waiting_input',
          ...status('Choosing the best photo', '2026-11-06T10:01:00.000Z'),
        } as Partial<Job>),
      ]),
    )
    expect(statuses.get(lot)).toEqual({
      step: 'research',
      text: 'Checking the datasheet',
      state: 'running',
    })
    expect(statuses.get(id(77))).toBeUndefined()
  })

  it('has no lead session when Examine runs without one', () => {
    const source = retainedJobsSource(snapshot([job(1, 'reading', 'running')]), subjects, lots)
    expect(source.lead).toBeNull()
  })

  it('lists open questions with their step and assumption, and counts them per step', () => {
    const source = retainedJobsSource(
      snapshot([
        job(1, 'identifying', 'waiting_for_user', {
          questions: [question(1, 'open', 'Assuming 10 kΩ'), question(2, 'answered')],
        } as Partial<Job>),
        job(3, 'research', 'waiting_for_user', {
          questions: [question(3, 'open')],
        } as Partial<Job>),
      ]),
      subjects,
      lots,
    )

    expect(source.questions).toEqual([
      {
        id: id(1),
        jobId: id(1),
        step: 'examine',
        subject: 'Packet A',
        prompt: 'Question 1?',
        assumption: 'Assuming 10 kΩ',
        lotId: lot,
      },
      {
        id: id(3),
        jobId: id(3),
        step: 'research',
        subject: 'Packet A',
        prompt: 'Question 3?',
        assumption: null,
        lotId: lot,
      },
    ])
    expect(source.steps.find((step) => step.step === 'examine')?.questions).toBe(1)
  })

  it('lists open questions oldest first across jobs, with untimed questions last', () => {
    const timed = (n: number, askedAt?: string) => ({
      ...question(n, 'open'),
      ...(askedAt ? { asked_at: askedAt } : {}),
    })

    const source = retainedJobsSource(
      snapshot([
        job(1, 'identifying', 'waiting_for_user', {
          questions: [timed(1, '2026-11-08T04:00:00.000Z'), timed(2)],
        } as Partial<Job>),
        job(3, 'research', 'waiting_for_user', {
          questions: [timed(3, '2026-11-08T03:00:00.000Z')],
        } as Partial<Job>),
      ]),
      subjects,
      lots,
    )
    expect(source.questions.map((item) => item.id)).toEqual([id(3), id(1), id(2)])
  })

  it('names the batch-level job and an unknown subject without inventing one', () => {
    const source = retainedJobsSource(
      snapshot([
        job(1, 'examine', 'running', {
          subject_id: null,
          session_state: 'running',
        } as Partial<Job>),
        job(2, 'research', 'running', {
          subject_id: id(77),
          session_state: 'running',
        } as Partial<Job>),
      ]),
      subjects,
      lots,
    )

    expect(source.sessions.map((session) => session.subject)).toEqual([
      'Whole batch',
      'Unknown subject',
    ])
  })

  it('names a whole-batch question without linking a lot', () => {
    const open = question(5, 'open')
    const source = retainedJobsSource(
      snapshot([
        job(5, 'examine', 'waiting_for_user', {
          subject_id: null,
          questions: [{ ...open, spec: { ...open.spec, subject_id: null } }],
        } as Partial<Job>),
      ]),
      subjects,
      lots,
    )

    expect(source.questions).toEqual([
      expect.objectContaining({ subject: 'Whole batch', lotId: null, prompt: 'Question 5?' }),
    ])
  })

  it('lays out the lead session, then each lot’s Research and Images in parallel before Inventory', () => {
    const proposal = (n: number, currentness: Record<string, string>) => ({
      id: id(n),
      message_id: id(n + 1),
      value: { subject_id: lot, summary: 'Candidate' },
      currentness,
    })

    const source = retainedJobsSource(
      snapshot([
        job(1, 'examine', 'running', {
          subject_id: null,
          session_state: 'running',
        } as Partial<Job>),
        job(2, 'research', 'running', {
          session_state: 'running',
          proposals: [proposal(10, { state: 'stale', reason: 'answer_received' })],
        } as Partial<Job>),
        job(3, 'images', 'ready', {
          session_state: 'finished',
          proposals: [proposal(12, { state: 'provisional' })],
        } as Partial<Job>),
        // A legacy attempt never joins the pipeline.
        job(4, 'inventory', 'ready'),
      ]),
      subjects,
      lots,
    )

    expect(source.pipeline.lead).toEqual({ jobId: id(1), state: 'running' })
    expect(source.pipeline.lots).toEqual([
      {
        lotId: lot,
        label: 'Packet A',
        cells: {
          research: { jobId: id(2), state: 'running', stale: 1, provisional: 0 },
          images: { jobId: id(3), state: 'ready', stale: 0, provisional: 1 },
          inventory: null,
        },
      },
    ])
  })

  it('says which steps have no retained work', () => {
    const source = retainedJobsSource(snapshot([job(1, 'reading', 'ready')]), subjects, lots)

    expect(source.steps.filter((step) => step.jobs === 0).map((step) => step.step)).toEqual([
      'research',
      'images',
      'inventory',
    ])
  })
})

it('links a question to Review only when it is about an active lot', () => {
  const part = id(80)
  const source = retainedJobsSource(
    snapshot([
      job(1, 'research', 'waiting_for_user', {
        questions: [
          question(1, 'open'),
          { ...question(2, 'open'), spec: { ...question(2, 'open').spec, subject_id: part } },
        ],
      } as Partial<Job>),
    ]),
    new Map([
      [lot, 'Packet A'],
      [part, 'Shared Part'],
    ]),
    lots,
  )

  expect(source.questions.map((item) => [item.subject, item.lotId])).toEqual([
    ['Packet A', lot],
    ['Shared Part', null],
  ])
})

describe('subjectStatuses', () => {
  const status = (n: number, stage: string, state: string, text: string, at: string) =>
    job(n, stage, 'running', { session_state: state, latest_status: { text, at } } as Partial<Job>)

  it('takes a lot’s newest line among live sessions only', () => {
    const statuses = subjectStatuses(
      snapshot([
        status(1, 'images', 'running', 'Choosing a photo', '2026-11-06T10:00:00.000Z'),
        status(2, 'research', 'finished', 'Done checking', '2026-11-06T10:05:00.000Z'),
      ]),
    )
    expect(statuses.get(lot)?.text).toBe('Choosing a photo')
    expect(
      subjectStatuses(
        snapshot([
          status(1, 'images', 'cancelled', 'Stopped', '2026-11-06T10:00:00.000Z'),
          status(2, 'research', 'finished', 'Done checking', '2026-11-06T10:05:00.000Z'),
        ]),
      ).has(lot),
    ).toBe(false)
  })
})

describe('retainedJobsSource step counts', () => {
  it('leaves a retired lot’s job out of its step, so the step can reach done, but keeps it listed', () => {
    const retired = id(91)
    const part = id(92)
    const source = retainedJobsSource(
      snapshot([
        job(1, 'research', 'ready'),
        job(2, 'research', 'superseded', { subject_id: retired }),
        job(3, 'research', 'ready', { subject_id: part }),
        job(4, 'examine', 'ready', { subject_id: null }),
      ]),
      subjects,
      lots,
      new Set([retired]),
    )

    expect(source.steps.find((step) => step.step === 'research')).toMatchObject({
      jobs: 2,
      ready: 2,
    })
    expect(source.steps.find((step) => step.step === 'examine')).toMatchObject({
      jobs: 1,
      ready: 1,
    })
    // Its history stays on the step page.
    expect(source.jobsOn('research').map((item) => item.id)).toEqual([id(1), id(2), id(3)])
  })
})

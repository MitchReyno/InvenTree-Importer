import { describe, expect, it } from 'vitest'
import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { retainedJobsSource } from './source'

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
      { jobId: id(1), step: 'research', subject: 'Packet A', state: 'waiting_input' },
    ])
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
        job(1, 'examine', 'running', { subject_id: null } as Partial<Job>),
        job(2, 'research', 'running', {
          proposals: [proposal(10, { state: 'stale', reason: 'answer_received' })],
        } as Partial<Job>),
        job(3, 'images', 'ready', {
          proposals: [proposal(12, { state: 'provisional' })],
        } as Partial<Job>),
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

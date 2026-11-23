import { describe, expect, it } from 'vitest'
import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { lotSteps, stepSummary } from './lot-steps'

const digest = 'a'.repeat(64)

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

type Job = ProcessingSnapshotDto['jobs'][number]
type Lot = CaptureSnapshotDto['lots'][number]

const diodes = id(90)
const resistors = id(91)
const part = id(80)

function job(n: number, subject: string | null, stage: string, state: string): Job {
  return {
    id: id(n),
    subject_id: subject,
    stage,
    revision: '1',
    state,
    attempt_id: id(n + 40),
    input_sha256: digest,
    attempt_number: '1',
    qualification: 'fixture_only',
    proposals: [],
    questions: [],
  } as Job
}

function lot(lotId: string, label: string, partId: string | null = null): Lot {
  return { id: lotId, label, part_subject_id: partId } as Lot
}

const lots = [lot(resistors, 'Resistors'), lot(diodes, 'GE S2CN1 diodes', part)]

describe('lotSteps', () => {
  it('gives each lot its Research, Images and Inventory state, Not started without a job', () => {
    const rows = lotSteps(
      [
        job(1, null, 'examine', 'ready'),
        job(2, resistors, 'research', 'ready'),
        job(3, resistors, 'images', 'running'),
      ],
      lots,
    )

    expect(rows.map((row) => row.label)).toEqual(['GE S2CN1 diodes', 'Resistors'])
    const resistorSteps = rows[1].steps
    expect(resistorSteps.research).toMatchObject({ state: 'done', job: { id: id(2) } })
    expect(resistorSteps.images.state).toBe('working')
    expect(resistorSteps.inventory).toEqual({ state: 'not_started', job: null, partId: null })
  })

  it('puts a Part’s job under each of its lots, shared through the Part', () => {
    const rows = lotSteps([job(4, part, 'research', 'waiting_for_user')], lots)
    const diodeRow = rows.find((row) => row.lotId === diodes)!

    expect(diodeRow.steps.research).toMatchObject({
      state: 'waiting_for_you',
      job: { id: id(4) },
      partId: part,
    })
    expect(rows.find((row) => row.lotId === resistors)!.steps.research.state).toBe('not_started')
  })

  it('prefers the lot’s own job to its Part’s, and a current attempt to a replaced one', () => {
    const rows = lotSteps(
      [
        job(5, part, 'images', 'ready'),
        job(6, diodes, 'images', 'superseded'),
        job(7, diodes, 'images', 'failed'),
      ],
      lots,
    )

    expect(rows.find((row) => row.lotId === diodes)!.steps.images).toMatchObject({
      state: 'failed',
      job: { id: id(7) },
      partId: null,
    })
  })

  it('reads queued work in a paused batch as paused', () => {
    const rows = lotSteps([job(8, resistors, 'research', 'queued')], lots, { paused: true })

    expect(rows.find((row) => row.lotId === resistors)!.steps.research.state).toBe('paused')
  })
})

describe('stepSummary', () => {
  it('counts the distinct lots a step covers and their states', () => {
    const rows = lotSteps(
      [
        job(1, null, 'examine', 'ready'),
        job(2, resistors, 'research', 'ready'),
        job(3, resistors, 'images', 'ready'),
      ],
      lots,
    )

    expect(stepSummary('research', rows, [])).toEqual({ text: '1 lot · 1 done', state: 'done' })
  })

  it('counts each lot once, whether its own job or its Part’s covers it', () => {
    const rows = lotSteps(
      [job(2, resistors, 'research', 'running'), job(4, part, 'research', 'failed')],
      lots,
    )

    expect(stepSummary('research', rows, [])).toEqual({
      text: '2 lots · 1 working · 1 failed',
      state: 'failed',
    })
  })

  it('counts lots formed for Examine, which runs once for the batch', () => {
    const rows = lotSteps([], lots)

    expect(stepSummary('examine', rows, [job(1, null, 'examine', 'ready')])).toEqual({
      text: '2 lots formed',
      state: 'done',
    })
  })

  it('gives Examine its lead’s state, paused with the batch, over older Reading jobs', () => {
    const lead = { ...job(1, null, 'examine', 'queued'), session_state: 'queued' } as Job
    const reading = job(2, resistors, 'reading', 'failed')

    expect(stepSummary('examine', lotSteps([], lots), [lead, reading], { paused: true })).toEqual({
      text: '2 lots formed',
      state: 'paused',
    })
  })

  it('says when a step has no work yet', () => {
    expect(stepSummary('inventory', lotSteps([], lots), [])).toEqual({
      text: 'No work yet',
      state: 'not_started',
    })
  })
})

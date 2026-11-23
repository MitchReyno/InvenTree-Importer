import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import {
  type PillStatus,
  type ProgressStep,
  type SegmentState,
  type WorkState,
  workStateWord,
} from '#/components/ui'

type WorkItem = HeaderWorkDto['work'][number]
type Session = HeaderWorkDto['active_sessions'][number]

/** The Processing stages, in plan order. */
export const STAGES = ['examine', 'research', 'images', 'inventory'] as const

export type Stage = (typeof STAGES)[number]

/** One stage's counted work; the header and attention reads count the same fields. */
export type StageCounts = BatchAttentionDto['processing']['steps']['examine']

/** A counted batch: its live lots, whether it is paused, and each stage's work. */
export type BatchCounts = { paused: boolean; lots: number; steps: Record<Stage, StageCounts> }

function capitalised(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

/** State words as a reader says them: `waiting_for_user` reads "waiting for user". */
export function stateWords(state: string) {
  return state.replaceAll('_', ' ')
}

function stepName(step: WorkItem['steps'][number]) {
  return 'stage' in step ? step.stage : step.name
}

/** An import run's own steps; it fills only what its retained states say. */
export function segmentSteps(item: WorkItem): ProgressStep[] {
  return item.steps.map((step) => ({
    label: capitalised(stepName(step)),
    state: segmentState(step.state),
  }))
}

/** Reading and Identifying are the Examine step on the redesigned Processing tab. */
const STAGE_OF: Record<string, Stage> = {
  reading: 'examine',
  identifying: 'examine',
  examine: 'examine',
  research: 'research',
  images: 'images',
  inventory: 'inventory',
}

/** The Processing stage a retained stage belongs to, if any. */
export function stageOf(stage: string): Stage | undefined {
  return STAGE_OF[stage]
}

/** A batch's step counts: the open batch's attention read, else the header read's own count. */
export function batchStepCounts(
  data: HeaderWorkDto | undefined,
  batch: string | undefined,
  attention: BatchAttentionDto | undefined,
): BatchCounts | undefined {
  if (!batch) {
    return undefined
  }
  if (attention?.batch_id === batch) {
    const { paused, lots, steps } = attention.processing
    return { paused, lots, steps }
  }

  const entry = data?.batch_steps?.find((candidate) => candidate.batch_id === batch)
  return entry && { paused: entry.paused, lots: entry.lots, steps: entry.steps }
}

/** Whether a batch is paused: from its counts, else the header's list of paused batches. */
export function batchPaused(
  data: HeaderWorkDto | undefined,
  batch: string | undefined,
  counts: BatchCounts | undefined,
) {
  if (counts) {
    return counts.paused
  }

  return !!batch && !!data?.paused_batches.some((entry) => entry.batch_id === batch)
}

/** Examine is done once its lead job is ready; a lot stage once every live lot is ready there. */
function stageDone(stage: Stage, counts: StageCounts, lots: number) {
  if (stage === 'examine') {
    return counts.jobs > 0 && counts.ready >= counts.jobs
  }

  return lots > 0 && counts.ready_lots >= lots
}

/**
 * A counted stage's state, most pressing first. A turn already running finishes even in a paused
 * batch, so working outranks paused; a stage with no jobs yet is never done.
 */
function countedState(stage: Stage, counts: StageCounts, lots: number, paused: boolean) {
  const done = stageDone(stage, counts, lots)
  if (counts.failed > 0) {
    return 'failed'
  }
  if (counts.running > 0) {
    return 'working'
  }
  if (paused && !done) {
    return 'paused'
  }
  if (counts.waiting > 0 || counts.questions > 0) {
    return 'waiting_for_you'
  }
  if (counts.queued > 0) {
    return 'queued'
  }

  return done ? 'done' : 'not_started'
}

const RETAINED_STATE: Record<string, WorkState> = {
  running: 'working',
  stopping: 'working',
  waiting_for_user: 'waiting_for_you',
  waiting_for_login: 'waiting_for_you',
  queued: 'queued',
  waiting_for_capacity: 'queued',
  ready: 'done',
  failed: 'failed',
  interrupted: 'failed',
  cancelled: 'failed',
}

/** An uncounted stage reads its retained jobs' states, so it is never drawn as not started. */
function retainedState(states: readonly string[], paused: boolean): WorkState {
  const own = states.map((state) => RETAINED_STATE[state] ?? 'not_started')
  const done = own.length > 0 && own.every((state) => state === 'done')
  for (const state of ['failed', 'working'] as const) {
    if (own.includes(state)) {
      return state
    }
  }
  if (paused && !done) {
    return 'paused'
  }
  for (const state of ['waiting_for_you', 'queued'] as const) {
    if (own.includes(state)) {
      return state
    }
  }

  return done ? 'done' : 'not_started'
}

/** One stage's state and ready share, from its counts when the read has them. */
export function stageSegment(
  stage: Stage,
  counts: StageCounts | undefined,
  lots: number | undefined,
  paused: boolean,
  retained: readonly string[] = [],
): ProgressStep {
  const label = capitalised(stage)
  if (!counts || lots === undefined) {
    return { label, state: retainedState(retained, paused) }
  }

  const state = countedState(stage, counts, lots, paused)
  // Examine fills by its lead job's state; a lot stage by its share of the batch's live lots.
  const fraction = stage !== 'examine' && lots > 0 ? counts.ready_lots / lots : undefined
  return { label, state, ...(fraction === undefined ? {} : { fraction }) }
}

/**
 * A batch's Processing stages in plan order, from its counts where a read counts them, else from
 * the states of its retained jobs.
 */
export function processingSegments(
  items: WorkItem[],
  counts: BatchCounts | undefined,
  paused: boolean,
): ProgressStep[] {
  const retained = items.flatMap((item) => (item.kind === 'processing' ? item.steps : []))
  return STAGES.map((stage) => {
    const states = retained
      .filter((own) => 'stage' in own && stageOf(own.stage) === stage)
      .map((own) => own.state)
    return stageSegment(stage, counts?.steps[stage], counts?.lots, paused, states)
  })
}

/** "Research: 7 of 12" for the first stage counted as working. */
export function processingProgress(counts: BatchCounts | undefined) {
  for (const stage of STAGES) {
    const own = counts?.steps[stage]
    if (!counts || !own || own.running === 0) {
      continue
    }
    if (stage !== 'examine' && counts.lots > 0) {
      return `${capitalised(stage)}: ${own.ready_lots} of ${counts.lots}`
    }
    if (own.jobs > 0) {
      return `${capitalised(stage)}: ${own.ready} of ${own.jobs}`
    }
  }

  return ''
}

/** A stage row's count: "12 lots formed · 2 questions" for Examine, "7 of 12 lots" after it. */
export function stageCountText(stage: Stage, counts: BatchCounts | undefined) {
  const own = counts?.steps[stage]
  if (!counts || !own) {
    return ''
  }
  if (stage !== 'examine') {
    return `${own.ready_lots} of ${plural(counts.lots, 'lot')}`
  }

  const formed = `${plural(counts.lots, 'lot')} formed`
  return own.questions > 0 ? `${formed} · ${plural(own.questions, 'question')}` : formed
}

/** A stage row's pill word: "2 working" where the read counts who is working. */
export function stagePillWord(state: WorkState, counts: StageCounts | undefined) {
  if (state === 'working' && counts && counts.running > 0) {
    return `${counts.running} working`
  }

  return workStateWord(state)
}

const ENDED_ATTEMPTS = new Set(['cancelled', 'superseded'])

/**
 * A stage's newest agent status line, from its current, uncancelled attempts in the header's
 * bounded active-session list. A cancelled attempt still holding a slot never supplies it.
 */
export function stageStatus(stage: Stage, sessions: readonly Session[]) {
  return sessions
    .filter(
      (session) =>
        stageOf(session.stage) === stage && session.current && !ENDED_ATTEMPTS.has(session.state),
    )
    .map((session) => session.latest_status)
    .filter((status) => status !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
}

function lotStageDone(counts: BatchCounts, stage: 'research' | 'images') {
  return counts.lots > 0 && counts.steps[stage].ready_lots >= counts.lots
}

/** What a stage waits on before it can start, or undefined when nothing earlier holds it. */
function waitsOn(stage: Stage, counts: BatchCounts | undefined) {
  if (stage === 'examine' || !counts) {
    return undefined
  }
  if (counts.lots === 0) {
    return 'Starts when Examine forms lots'
  }
  if (
    stage === 'inventory' &&
    !(lotStageDone(counts, 'research') && lotStageDone(counts, 'images'))
  ) {
    return 'Starts when Research and Images finish a lot'
  }

  return undefined
}

/** A stage row's plain reason, shown when no listed agent session gives it a status line. */
export function stageReason(stage: Stage, state: WorkState, counts: BatchCounts | undefined) {
  const own = counts?.steps[stage]
  switch (state) {
    case 'failed':
      return own && own.failed > 1
        ? `${own.failed} attempts failed; open the step to see why`
        : 'An attempt failed; open the step to see why'
    case 'working':
      return 'An agent is working on this step'
    case 'paused':
      return counts && own && stage !== 'examine'
        ? `Paused at ${own.ready_lots} of ${plural(counts.lots, 'lot')}`
        : 'Paused until you resume'
    case 'waiting_for_you':
      return own && own.questions > 0
        ? `${plural(own.questions, 'question')} waiting for your answer`
        : 'Waiting for you'
    case 'queued':
      return waitsOn(stage, counts) ?? 'Queued for a free slot'
    case 'done':
      return stage === 'examine' ? 'Examine finished' : 'Every lot is done'
    case 'not_started':
      return waitsOn(stage, counts) ?? 'Not started yet'
  }
}

const SETTLED = ['ready', 'confirmed', 'finished', 'cancelled', 'superseded', 'settled_complete']

/** A batch's Processing jobs read as one entry; each import run is its own. */
export function jobGroup(item: WorkItem) {
  return item.kind === 'processing' ? `processing:${item.batch_id}` : `import:${item.id}`
}

/** Other entries still under way, apart from the one the indicator names. */
export function otherOpenJobs(work: WorkItem[], named: WorkItem | undefined) {
  // A job still holding its slot is under way, whatever its logical state.
  const open = work
    .filter(
      (item) => !SETTLED.includes(item.state) || (item.kind === 'processing' && item.occupies_lane),
    )
    .map(jobGroup)
  const others = new Set(open.filter((group) => !named || group !== jobGroup(named)))
  return others.size
}

type JobPill = { status: PillStatus; word: string }

const JOB_PILL: Record<string, JobPill> = {
  running: { status: 'running', word: 'Running' },
  stopping: { status: 'running', word: 'Stopping' },
  queued: { status: 'queued', word: 'Queued' },
  waiting_for_capacity: { status: 'queued', word: 'Queued' },
  waiting_for_user: { status: 'needs-answer', word: 'Waiting for you' },
  waiting_for_login: { status: 'warning', word: 'Waiting for login' },
  failed: { status: 'failed', word: 'Failed' },
  interrupted: { status: 'failed', word: 'Interrupted' },
  recovery_required: { status: 'failed', word: 'Needs recovery' },
  settled_incomplete: { status: 'failed', word: 'Incomplete' },
  ready: { status: 'complete', word: 'Done' },
  settled_complete: { status: 'complete', word: 'Done' },
  cancelled: { status: 'excluded', word: 'Cancelled' },
  superseded: { status: 'excluded', word: 'Superseded' },
}

/** A job's state pill. A job that still holds its slot says so, whatever its logical state. */
export function jobPill(item: WorkItem): JobPill {
  const own = JOB_PILL[item.state] ?? {
    status: 'draft' as const,
    word: capitalised(stateWords(item.state)),
  }
  if (item.kind === 'processing' && item.occupies_lane && own.status !== 'running') {
    return { status: 'running', word: `${own.word} · slot held` }
  }

  return own
}

const PILL_RANK: PillStatus[] = [
  'failed',
  'needs-answer',
  'warning',
  'running',
  'queued',
  'complete',
]

/** A batch's Processing entry takes the most pressing of its jobs' pills. */
export function batchPill(jobs: WorkItem[]): JobPill {
  const pills = jobs.map(jobPill)

  const rank = (pill: JobPill) => {
    const index = PILL_RANK.indexOf(pill.status)
    return index === -1 ? PILL_RANK.length : index
  }

  return pills.sort((a, b) => rank(a) - rank(b))[0] ?? JOB_PILL.queued
}

/** One short word for the phone pill; a held slot outranks the job's logical state. */
export function compactJobWord(item: WorkItem) {
  if (item.kind === 'processing' && item.occupies_lane && segmentState(item.state) !== 'working') {
    return 'Slot held'
  }

  return jobPill(item).word
}

/** A retained step state as a work state; an import step that is unknown or mixed is not started. */
function segmentState(state: string): SegmentState {
  return RETAINED_STATE[state] ?? (stepTone(state) === 'done' ? 'done' : 'not_started')
}

type StepTone = 'done' | 'running' | 'failed' | 'other'

const STEP_TONE: Record<string, StepTone> = {
  ready: 'done',
  confirmed: 'done',
  finished: 'done',
  queued: 'running',
  running: 'running',
  waiting_for_user: 'running',
  waiting_for_login: 'running',
  waiting_for_capacity: 'running',
  failed: 'failed',
  interrupted: 'failed',
  cancelled: 'failed',
}

export function stepTone(state: string): StepTone {
  return STEP_TONE[state] ?? 'other'
}

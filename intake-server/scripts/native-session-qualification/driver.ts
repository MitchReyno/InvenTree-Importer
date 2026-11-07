/**
 * Live native-session qualification driver. Runs one scripted operator flow against an
 * isolated development app and records evidence outside the repository. It sends real
 * provider requests, so run it only with explicit authorization; see README.md.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createCanvas } from '@napi-rs/canvas'
import {
  agentsClient,
  captureClient,
  intakeClient,
  mediaClient,
  processingClient,
} from '@invimport/contracts/client'
import type {
  ProcessingJobDto,
  ProcessingSnapshotDto,
  SessionTimelineDto,
} from '@invimport/contracts'
import { chatHandled } from './chat.ts'

const { values: args } = parseArgs({
  options: {
    origin: { type: 'string', default: 'http://127.0.0.1:4331' },
    provider: { type: 'string' },
    model: { type: 'string' },
    state: { type: 'string' },
    out: { type: 'string' },
    /** Shortens every wait, for a synthetic dry run of the driver itself. */
    'timeout-scale': { type: 'string', default: '1' },
  },
})
const provider = args.provider as 'claude' | 'codex'
if (!['claude', 'codex'].includes(provider) || !args.model || !args.state || !args.out) {
  throw new Error('usage: --provider claude|codex --model ID --state APP_STATE --out DIR')
}
const origin = args.origin!
const scale = Number(args['timeout-scale'])
const out = args.out
const log: Record<string, unknown>[] = []
function note(event: string, detail: Record<string, unknown> = {}) {
  const entry = { at: new Date().toISOString(), event, ...detail }
  log.push(entry)
  process.stdout.write(JSON.stringify(entry) + '\n')
}

const transport: typeof fetch = (input, init) => {
  const request = new Request(input, init)
  request.headers.set('origin', origin)
  return fetch(request)
}
const { csrf_token: csrf } = (await intakeClient(origin, transport).bootstrap()) as {
  csrf_token: string
}
const capture = captureClient(origin, csrf, transport)
const media = mediaClient(origin, csrf, transport)
const processing = processingClient(origin, csrf, transport)
const agents = agentsClient(origin, csrf, transport)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until<T>(what: string, seconds: number, probe: () => Promise<T | undefined>) {
  const deadline = Date.now() + seconds * scale * 1000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) {
      return value
    }
    await sleep(3000)
  }
  note('timeout', { what })
  return undefined
}

function card(lines: string[]) {
  const canvas = createCanvas(1200, 800)
  const context = canvas.getContext('2d')
  context.fillStyle = '#f4f1e8'
  context.fillRect(0, 0, 1200, 800)
  context.fillStyle = '#111'
  context.font = 'bold 64px sans-serif'
  lines.forEach((line, index) => context.fillText(line, 60, 150 + index * 130))
  return new Blob([new Uint8Array(canvas.toBuffer('image/png'))], { type: 'image/png' })
}
async function upload(batchId: string, label: string, lines: string[]) {
  const snapshot = await media.snapshot(batchId)
  const receipt = await media.upload(batchId, snapshot.revision, label, card(lines), randomUUID())
  note('uploaded', { label })
  return receipt
}

async function settle(selection: { model: string }) {
  const current = await agents.settings()
  await agents.saveSettings({
    expected_revision: current.revision,
    selection: { provider, authentication: 'subscription', model: selection.model },
    session_concurrency: 3,
  })
  note('settings', { provider, model: selection.model })
}

const terminal = new Set(['ready', 'failed', 'cancelled', 'superseded', 'interrupted'])
const idleSession = new Set(['finished', 'waiting_input', 'cancelled', 'failed', 'interrupted'])
const read = (batchId: string) => processing.read(batchId) as Promise<ProcessingSnapshotDto>
const timeline = (batchId: string, jobId: string) =>
  processing.session(batchId, jobId) as Promise<SessionTimelineDto>
const running = (job: ProcessingJobDto) =>
  job.state === 'running' && job.session_state === 'running'

const leadObservations = (line?: SessionTimelineDto) =>
  line?.outbox.filter((item) => item.kind === 'observation').length ?? 0
const chats: { batchId: string; jobId: string; id: string; text: string; sentAt: string }[] = []
async function chat(batchId: string, jobId: string, text: string, purpose: string) {
  const receipt = await processing.chat(
    batchId,
    jobId,
    { idempotency_key: randomUUID(), text },
    randomUUID(),
  )
  chats.push({ batchId, jobId, id: receipt.item_id, text, sentAt: new Date().toISOString() })
  note('chat', { purpose, jobId })
}

// 1. Settings and capture.
await settle({ model: args.model })
const batch = await capture.create(
  { title: `Native qualification ${provider}`, note: 'Synthetic label cards only.' },
  randomUUID(),
)
const batchId = batch.id as string
note('batch', { batchId })
await upload(batchId, 'Shelf', ['1N4148 diodes x100', '16 MHz crystal', 'LED 0603 red x500'])
await upload(batchId, 'Reel close-up', ['LED 0603 RED', '500 pcs'])

// 2. Examine lead: chat while it runs.
const leadRunning = await until('lead running', 300, async () =>
  (await read(batchId)).jobs.find((job) => job.stage === 'examine' && running(job)),
)
const lead = leadRunning ?? (await read(batchId)).jobs.find((job) => job.stage === 'examine')
if (leadRunning) {
  await chat(
    batchId,
    leadRunning.id,
    'The LED reel might be a 5000 piece reel rather than 500. Please check the reel label.',
    'lead in-turn chat',
  )
}

// 3. Per-lot sessions: chat to one and cancel another while they run.
let cancelled: string | undefined
let chatted: string | undefined
await until('per-lot sessions', 900, async () => {
  const jobs = (await read(batchId)).jobs.filter((job) => job.stage !== 'examine')
  for (const job of jobs.filter(running)) {
    if (!chatted) {
      chatted = job.id
      await chat(
        batchId,
        job.id,
        'The supplier packing slip lists this lot as 5000 pieces. Does that match the photos?',
        'per-lot in-turn chat',
      )
    } else if (!cancelled && job.id !== chatted && job.can_cancel) {
      cancelled = job.id
      await processing.cancel(
        batchId,
        job.id,
        { expected_revision: job.revision, attempt_id: job.attempt_id },
        randomUUID(),
      )
      note('cancel', { jobId: job.id, stage: job.stage })
    }
  }
  return chatted && cancelled ? true : undefined
})

// 4. Wait for every session to settle.
const quiet = async () => {
  const jobs = (await read(batchId)).jobs
  return jobs.length > 1 &&
    jobs.every(
      (job) =>
        terminal.has(job.state) ||
        job.state === 'waiting_for_user' ||
        idleSession.has(job.session_state ?? ''),
    )
    ? jobs
    : undefined
}
await until('settled', 1200, quiet)
note('settled')

// 5. New evidence after finishing: the lead resumes and lot sessions may cite it.
const before = await read(batchId)
const observationsBefore = lead ? leadObservations(await timeline(batchId, lead.id)) : 0
await upload(batchId, 'Reel back', ['LED 0603 RED reel back', 'Lot 2245  500 pcs'])
const reelBack = await until('reel back decoded', 300, async () => {
  const evidence = (await media.snapshot(batchId)).evidence.find(
    (item) => item.versions.length && item.label === 'Reel back',
  )
  const version = evidence?.versions.find((item) => item.kind === 'original')
  return version?.state === 'ready' ? version : undefined
})
await sleep(30000 * scale)
await until('resumed and settled', 1200, quiet)

// 6. Chat to a finished per-lot session (resume after finish).
const finished = (await read(batchId)).jobs.find(
  (job) => job.stage !== 'examine' && job.session_state === 'finished' && job.id !== cancelled,
)
if (finished) {
  await chat(
    batchId,
    finished.id,
    'One more check: is the 500 pcs count on the reel label still your answer?',
    'chat after finish',
  )
  await sleep(20000 * scale)
  await until('post-chat settled', 600, quiet)
}

// 7. Diagnostics: an unknown model fails at the provider; read its retained details.
let diagnostic: unknown
const cancelledJob = cancelled
  ? (await read(batchId)).jobs.find((item) => item.id === cancelled)
  : undefined
const cancellation = cancelledJob
  ? { state: cancelledJob.state, session_state: cancelledJob.session_state }
  : 'not reached'
if (cancelled) {
  await settle({ model: `${args.model}-not-a-model` })
  const job = (await read(batchId)).jobs.find((item) => item.id === cancelled)!
  await processing.replaceSession(
    batchId,
    job.id,
    {
      expected_capture_revision: (await read(batchId)).capture_revision,
      expected_revision: job.revision,
      attempt_id: job.attempt_id,
    },
    randomUUID(),
  )
  note('replacement', { jobId: job.id })
  const failed = await until('replacement failure', 300, async () => {
    const current = (await read(batchId)).jobs.find((item) => item.id === cancelled)
    return current && current.attempt_id !== job.attempt_id && terminal.has(current.state)
      ? current
      : undefined
  })
  if (failed) {
    const summary = (await timeline(batchId, failed.id)).failure
    diagnostic = summary
      ? await agents.failure(failed.attempt_id, summary.id)
      : { session_state: failed.session_state }
  }
  await settle({ model: args.model })
}

// 8. Collect.
const final = await read(batchId)
const timelines: Record<string, SessionTimelineDto> = {}
const failures: Record<string, unknown> = {}
for (const job of final.jobs) {
  timelines[job.id] = await timeline(batchId, job.id)
  const failure = timelines[job.id].failure
  if (failure?.details_available) {
    failures[job.id] = await agents.failure(job.attempt_id, failure.id)
  }
}
const allQuestions = final.jobs.flatMap((job) => job.questions)
const questions = Object.fromEntries(
  allQuestions.map((question) => [
    question.id,
    {
      prompt: question.spec.prompt,
      reason: question.spec.reason,
      assumption: question.assumption ?? '',
    },
  ]),
)
// Provider transcripts for this batch only: Claude by session directory, Codex by conversation.
const conversations = new Set<string>()
let page: string | undefined
do {
  const list = await agents.sessions(page)
  for (const session of list.sessions) {
    if (session.batch_id === batchId && session.native_session_id) {
      conversations.add(session.native_session_id)
    }
  }
  page = list.next_before ?? undefined
} while (page)

async function transcriptFiles() {
  const files: string[] = []
  const jobIds = final.jobs.map((job) => job.id)
  const roots =
    provider === 'claude'
      ? [join(homedir(), '.claude/projects')]
      : [join(args.state!, 'agents/codex/sessions')]
  const stack = [...roots]
  while (stack.length) {
    const dir = stack.pop()!
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        // Claude keeps one project directory per session working directory, named by job.
        if (
          provider === 'codex' ||
          jobIds.some((id) => entry.name.includes(id)) ||
          dir !== roots[0]
        ) {
          stack.push(path)
        }
      } else if (
        entry.name.endsWith('.jsonl') &&
        (provider === 'claude' || [...conversations].some((id) => entry.name.includes(id)))
      ) {
        files.push(path)
      }
    }
  }
  return files
}
const files = await transcriptFiles()
const entries: { at: number; line: string; value: Record<string, any> }[] = []
for (const file of files) {
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    if (line) {
      const value = JSON.parse(line)
      entries.push({ at: Date.parse(value.timestamp ?? ''), line, value })
    }
  }
}
/** The first transcript entry after sending that carries the chat: its read or delivery. */
function readAt(sent: (typeof chats)[number]) {
  const at = entries
    .filter(
      (entry) =>
        entry.at >= Date.parse(sent.sentAt) &&
        (entry.line.includes(sent.id) || entry.line.includes(sent.text.slice(0, 48))),
    )
    .map((entry) => entry.at)
    .sort((a, b) => a - b)[0]
  return at === undefined ? undefined : new Date(at).toISOString()
}

const chatResults = chats.map((sent) => {
  const outbox = timelines[sent.jobId]?.outbox ?? []
  const sessionId = outbox[0]?.session_id ?? ''
  const read = readAt(sent)
  return {
    purpose: log.find((entry) => entry.event === 'chat' && entry.jobId === sent.jobId)?.purpose,
    jobId: sent.jobId,
    read_at: read ?? 'not observed',
    ...chatHandled({
      chat: { id: sent.id, session_id: sessionId, created_at: sent.sentAt, text: sent.text },
      readAt: read,
      outbox: outbox.filter((item) => item.session_id === sessionId),
      questions,
    }),
  }
})

/** Outbox activity separated by more than two minutes is treated as separate turns. */
const cadence = Object.fromEntries(
  Object.entries(timelines).map(([jobId, line]) => {
    const items = [...line.outbox].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    )
    const turns: (typeof items)[] = []
    for (const item of items) {
      const last = turns.at(-1)?.at(-1)
      if (last && Date.parse(item.created_at) - Date.parse(last.created_at) <= 120_000) {
        turns.at(-1)!.push(item)
      } else {
        turns.push([item])
      }
    }
    return [
      jobId,
      turns.map((turn) => {
        const start = Date.parse(turn[0].created_at)
        const end = Date.parse(turn.at(-1)!.created_at)
        const statuses = turn
          .filter((item) => item.kind === 'status')
          .map((item) => Date.parse(item.created_at))
        const marks = [start, ...statuses, end]
        const gaps = marks.slice(1).map((at, index) => Math.round((at - marks[index]) / 1000))
        return {
          span_s: Math.round((end - start) / 1000),
          statuses: statuses.length,
          first_status_after_s: statuses.length ? Math.round((statuses[0] - start) / 1000) : null,
          longest_silence_s: Math.max(0, ...gaps),
        }
      }),
    ]
  }),
)
const cited = reelBack
  ? final.jobs
      .filter((job) => JSON.stringify(job.proposals).includes(reelBack.digest))
      .map((job) => ({ jobId: job.id, stage: job.stage }))
  : []
const resumeObservations = lead
  ? { before: observationsBefore, after: leadObservations(timelines[lead.id]) }
  : 'not reached'

const used = new Set<string>()
const offered = new Set<string>()
for (const { value } of entries) {
  for (const block of value.message?.content ?? []) {
    if (block?.type === 'tool_use' || block?.type === 'server_tool_use') used.add(block.name)
  }
  const payload = value.payload ?? {}
  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    used.add(payload.namespace ? `${payload.namespace}.${payload.name}` : payload.name)
  }
  for (const tool of payload.tools ?? []) offered.add(String(tool.name ?? tool))
}
// Claude transcripts do not keep the offered list; the adapter's init check enforces it.
const tools = {
  transcripts: files.length,
  used: [...used].sort(),
  offered: provider === 'codex' ? [...offered].sort() : 'not recorded',
}

const results = {
  provider,
  model: args.model,
  batchId,
  jobs: final.jobs.map((job) => ({
    id: job.id,
    stage: job.stage,
    state: job.state,
    session_state: job.session_state,
    proposals: job.proposals.length,
    attempt_number: job.attempt_number,
  })),
  questions: allQuestions.map((question) => ({
    state: question.state,
    prompt: question.spec.prompt,
    assumption: question.assumption,
  })),
  chats: chatResults,
  cadence,
  citations: { reel_back_cited_by: cited, before_jobs: before.jobs.length },
  resume_observations: resumeObservations,
  cancellation,
  diagnostic,
  failures,
  tools,
}
await mkdir(out, { recursive: true, mode: 0o700 })
await writeFile(join(out, `${provider}-results.json`), JSON.stringify(results, null, 2))
await writeFile(join(out, `${provider}-timelines.json`), JSON.stringify(timelines, null, 2))
await writeFile(join(out, `${provider}-log.json`), JSON.stringify(log, null, 2))
note('done', { out })

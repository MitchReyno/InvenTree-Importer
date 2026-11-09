import type {
  BatchAttentionDto,
  CaptureEditDto,
  CaptureSnapshotDto,
  MediaSnapshotDto,
  MediaVersionDto,
} from '@invimport/contracts'
import { GlobalStyle } from '#/components/GlobalStyle'
import { Masthead } from '#/components/masthead/Masthead'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import type { MediaClient } from '#/media/types'
import { Batch } from '#/components/batches/Batch'
import { Batches } from '#/components/batches/Batches'
import { Main, PageContent } from '#/components/AppLayout'
import { useHashRoute } from '#/navigation/useHashRoute'
import { ApiClientsProvider } from '#/components/clients/ApiClientsProvider'

const noSteps = {
  examine: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  research: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  images: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  inventory: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
}

/** Owned browser fixture: synthetic clients only, no API, provider or InvenTree traffic. */
const scope = {
  origin: location.origin,
  actorId: '30000000-0000-4000-8000-000000000003',
  targetId: 'b0000000-0000-4000-8000-00000000000b',
  targetContextId: '40000000-0000-4000-8000-000000000004',
}

const batchId = '10000000-0000-4000-8000-000000000001'

const lotId = (n: number) => `50000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const lotNames = [
  '10 kΩ resistor 0603 — packet A',
  '10 kΩ resistor 0603 — packet B',
  'ATmega328P microcontroller',
  '1N4148 diodes (loose)',
  'LM358 op-amp tube',
]

const batch: CaptureSnapshotDto = {
  id: batchId,
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  title: 'Mouser 3381-22 + bench bag',
  revision: '7',
  archived: false,
  updated_at: '2026-11-06T09:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  parts: [],
  lots: lotNames.map((label, index) => ({
    id: lotId(index + 1),
    label,
    revision: '1',
    contribution_key: `60000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}`,
    part_subject_id: null,
    quantity: { mode: 'unknown' },
    location: { mode: 'inherit' },
    formed_at: new Date(Date.UTC(2026, 10, 8, 9, 4 + index * 3)).toISOString(),
  })),
  notes: [],
  observations: [],
  cursor: { stream_id: '70000000-0000-4000-8000-000000000007', sequence: '0' },
} as CaptureSnapshotDto

const groups = [
  { id: '80000000-0000-4000-8000-000000000001', label: 'Resistor packets' },
  { id: '80000000-0000-4000-8000-000000000002', label: 'Capacitors and ICs' },
  { id: '80000000-0000-4000-8000-000000000003', label: 'Paperwork' },
]

const files: { label: string; group: number | null; lots: number[]; pdf?: boolean }[] = [
  { label: 'Resistor packet A', group: 0, lots: [1] },
  { label: 'Resistor packet B', group: 0, lots: [2] },
  { label: 'Capacitor reel label', group: 1, lots: [] },
  { label: 'MCU close-up', group: 1, lots: [3] },
  { label: 'Regulator and USB-C', group: 1, lots: [3, 5] },
  { label: 'LM358 tube', group: 1, lots: [5] },
  { label: 'Packing slip 3381-22', group: 2, lots: [1, 2, 3], pdf: true },
  { label: 'Invoice page 2', group: 2, lots: [], pdf: true },
  { label: 'Bench bag spill', group: null, lots: [4] },
  { label: 'Bench bag close-up', group: null, lots: [4] },
  { label: 'IMG_2214.jpg', group: null, lots: [] },
]

function version(index: number, pdf: boolean): MediaVersionDto {
  const id = `c0000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`
  return {
    id,
    evidence_id: `a0000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
    kind: 'original',
    digest: 'a'.repeat(64),
    byte_size: '204800',
    media_type: pdf ? 'application/pdf' : 'image/jpeg',
    // The last file is still being prepared, to show that state.
    state: index === files.length ? 'queued' : 'ready',
    decoder_build: 'fixture/1',
    recipe: null,
    pages:
      index === files.length
        ? []
        : [
            {
              page: 1,
              width: 1200,
              height: 900,
              preview_id: `d0000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
            },
          ],
  } as MediaVersionDto
}

const media: MediaSnapshotDto = {
  batch_id: batchId,
  revision: '3',
  groups,
  evidence: files.map((file, index) => ({
    id: `a0000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}`,
    label: file.label,
    group_id: file.group === null ? null : groups[file.group].id,
    linked_subject_ids: file.lots.map(lotId),
    ...(index === 3
      ? { note: { text: 'Taken under the magnifier. The last letter is hard to read.' } }
      : {}),
    versions: [version(index + 1, file.pdf ?? false)],
  })),
  attachments: [],
  derivations: [],
} as unknown as MediaSnapshotDto

const attention: BatchAttentionDto = {
  batch_id: batchId,
  revision: '7',
  processing: { questions: 3, failed: 0, running: 0, steps: noSteps },
  review: { to_check: 4, changed_after_review: 1, to_decide: 2, records: 0 },
  changes: { ready: 1, failed: 0, uncertain: 0, runs: 0 },
  items: [
    {
      key: 'question:q1',
      group: 'question',
      tab: 'processing',
      title: 'Is the last letter of the MCU marking a P?',
      detail: 'Assuming ATmega328P',
      route: `${batchId}/processing/examine/q1`,
    },
    {
      key: 'question:q2',
      group: 'question',
      tab: 'processing',
      title: 'How many diodes are in the bag?',
      detail: 'Assuming about 200',
      route: `${batchId}/processing/examine/q2`,
    },
    {
      key: 'question:q3',
      group: 'question',
      tab: 'processing',
      title: 'Which supplier SKU is the LM358 tube?',
      detail: null,
      route: `${batchId}/processing/research/q3`,
    },
    {
      key: `changed:${lotId(2)}`,
      group: 'changed_lot',
      tab: 'review',
      title: lotNames[1],
      detail: 'Changed since it was reviewed',
      route: `${batchId}/review/lots/${lotId(2)}`,
    },
    {
      key: `decision:stock_item:${lotId(3)}`,
      group: 'decision',
      tab: 'review',
      title: 'Choose the Part for this lot.',
      detail: lotNames[2],
      route: `${batchId}/review/records/stock_item/${lotId(3)}`,
    },
  ],
  items_truncated: false,
}

const issue = (lot: number, code: string, severity: 'blocking' | 'warning', message: string) => ({
  code,
  severity,
  message,
  subject_id: lotId(lot),
  lot_id: lotId(lot),
  run_id: null,
  dependency_digest: severity === 'warning' ? 'a'.repeat(64) : null,
  disposition: null,
})

const operatorReview = {
  batch_id: batchId,
  revision: batch.revision,
  lots: lotNames.map((label, index) => ({
    lot_id: lotId(index + 1),
    label,
    part_subject_id: null,
    shared_lot_ids: [],
    review_state: index === 0 ? 'reviewed' : index === 1 ? 'changed_after_review' : 'unreviewed',
    approved: false,
    issues:
      index === 2
        ? [
            issue(3, 'part_choice_required', 'blocking', 'Choose the Part for this lot.'),
            issue(
              3,
              'quantity_required',
              'blocking',
              'Choose an exact positive quantity for this lot.',
            ),
          ]
        : index === 4
          ? [issue(5, 'no_supporting_evidence', 'warning', 'Only one photo supports this lot.')]
          : [],
    predecessor_lot_ids: [],
  })),
  retired_lots: [],
  instructions: [],
  cursor: batch.cursor,
}

const unsupported = async () => {
  throw new Error('fixture commands are disabled')
}

const manualClient = {
  workspace: async () => ({
    batch_id: batchId,
    revision: batch.revision,
    supported: true,
    capability: 'owned-fake-stock/1',
    lots: batch.lots.map((lot) => ({ lot_id: lot.id, reviewed: false, issues: [] })),
    runs: [],
    preparations: [],
    preparations_truncated: false,
    cursor: batch.cursor,
  }),
  activity: async () => ({ runs: [], truncated: false }),
  review: unsupported,
  prepare: unsupported,
  approve: unsupported,
  run: unsupported,
  start: unsupported,
  cancel: unsupported,
  recover: unsupported,
}

/** As the server words it: issue messages hold 256 characters, so a long reason is shortened. */
function clipReason(reason: string) {
  const characters = Array.from(reason)
  return characters.length > 200 ? `${characters.slice(0, 199).join('')}…` : reason
}

const operatorClient = {
  // Follows the batch, which `?agents` edits advance.
  read: async () => ({
    ...operatorReview,
    revision: batch.revision,
    lots: operatorReview.lots.map((lot) => {
      const excluded = batch.lots.find((item) => item.id === lot.lot_id)?.excluded
      // As on the server, an excluded lot's only issue is its exclusion.
      return excluded
        ? {
            ...lot,
            excluded,
            issues: [
              {
                code: 'lot_excluded',
                severity: 'blocking',
                message: `Excluded: ${clipReason(excluded.reason)}. Include it again to add it.`,
                subject_id: lot.lot_id,
                lot_id: lot.lot_id,
                run_id: null,
                dependency_digest: null,
                disposition: null,
              },
            ],
          }
        : lot
    }),
  }),
  dismiss: unsupported,
  bulkEdit: unsupported,
  restructure: unsupported,
  instruct: unsupported,
}

type Change = CaptureEditDto['change']

/** With `?agents`, region and reading edits apply, so a correction shows once saved. */
function applyEdit(change: Change) {
  if (!agents) {
    return batch
  }
  const observations = batch.evidence_observations ?? []
  if (change.kind === 'observation') {
    const before = observations.find((item) => item.id === change.observation_id)
    const next = {
      ...(before ?? observations[0]),
      id:
        before?.id ??
        `e0000000-0000-4000-8000-0000000001${String(observations.length).padStart(2, '0')}`,
      evidence_version_id: change.evidence_version_id,
      page: change.page ?? 1,
      region: change.region,
      readings: change.readings ?? before?.readings ?? { markings: [] },
      // As on the server: an adjusted observation keeps its origin; a new one is the operator's.
      origin: before?.origin ?? ('operator' as const),
      operator_edited: true,
      lot_id: before?.lot_id ?? null,
    }
    batch.evidence_observations = before
      ? observations.map((item) => (item.id === before.id ? next : item))
      : [...observations, next]
    if (next.lot_id) {
      batch.lots = batch.lots.map((lot) =>
        lot.id === next.lot_id ? { ...lot, reexamine: true, operator_edited: true } : lot,
      )
    }
  } else if (change.kind === 'observation_move') {
    const moved = observations.find((item) => item.id === change.observation_id)
    batch.evidence_observations = observations.map((item) =>
      item.id === change.observation_id
        ? { ...item, lot_id: change.lot_id, operator_edited: true }
        : item,
    )
    // Both lots' membership follows the move, and both count as edited.
    batch.lots = batch.lots.map((lot) => {
      const ids = (lot.evidence_observation_ids ?? []).filter((id) => id !== change.observation_id)
      if (lot.id === change.lot_id) {
        return {
          ...lot,
          evidence_observation_ids: [...ids, change.observation_id],
          operator_edited: true,
        }
      }
      return lot.id === moved?.lot_id
        ? { ...lot, evidence_observation_ids: ids, operator_edited: true }
        : lot
    })
  } else if (change.kind === 'observation_same_item') {
    batch.evidence_observations = observations.map((item) => {
      if (item.id !== change.observation_id) {
        return item
      }
      const { same_item_as: _was, ...unmarked } = item
      return change.same_as === null
        ? { ...unmarked, operator_edited: true }
        : { ...item, same_item_as: change.same_as, operator_edited: true }
    })
  } else if (change.kind === 'lot_exclusion') {
    batch.lots = batch.lots.map((lot) => {
      if (lot.id !== change.lot_id) {
        return lot
      }
      const { excluded: _was, ...included } = lot
      return change.reason === null
        ? included
        : { ...lot, excluded: { reason: change.reason, at: new Date().toISOString() } }
    })
  } else if (change.kind === 'add_lot') {
    const index = batch.lots.length + 1
    batch.lots = [
      ...batch.lots,
      {
        ...batch.lots[0],
        id: lotId(index),
        label: change.label,
        contribution_key: lotId(index + 40),
      },
    ]
  }
  batch.revision = String(Number(batch.revision) + 1)
  return { ...batch }
}

const captureClient = {
  read: async () => ({ ...batch }),
  edit: async (_id: string, request: { change: Change }) => applyEdit(request.change),
  list: async () => ({
    batches: [
      {
        id: batchId,
        title: batch.title,
        revision: batch.revision,
        archived: false,
        updated_at: ago(42),
        source_id: batch.source_id,
        workflow: {
          lots: 5,
          ready: 1,
          needs_review: 3,
          blocked: 1,
          approved: 0,
          open_questions: 3,
          active_jobs: 1,
          latest_round: null,
          steps: {
            examine: { jobs: 1, ready: 1, running: 0 },
            research: { jobs: 5, ready: 3, running: 2 },
            images: { jobs: 0, ready: 0, running: 0 },
            inventory: { jobs: 0, ready: 0, running: 0 },
          },
          evidence: { photos: 9, documents: 2, other: 0 },
          possible_duplicates: 1,
        },
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        title: 'Rockby order 55120',
        revision: '12',
        archived: false,
        updated_at: ago(10 * 24 * 60),
        source_id: batch.source_id,
        workflow: {
          lots: 6,
          ready: 0,
          needs_review: 0,
          blocked: 0,
          approved: 6,
          open_questions: 0,
          active_jobs: 0,
          evidence: { photos: 3, documents: 1, other: 0 },
          latest_round: {
            run_id: '40000000-0000-4000-8000-000000000004',
            round_number: '1',
            state: 'settled_complete',
            confirmed_stock: 6,
          },
        },
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        title: 'Drawer cleanup — loose ICs',
        revision: '2',
        archived: false,
        updated_at: ago(3 * 24 * 60),
        source_id: batch.source_id,
      },
    ],
    truncated: false,
  }),
  create: async () => batch,
}

const mediaClient: MediaClient = {
  snapshot: async () => media,
  edit: async () => media,
  upload: async () => {
    throw new Error('fixture uploads are disabled')
  },
}

// `?agents` adds BI-006 agent data: observations, an Examine lead session and a Research session.
const agents = new URLSearchParams(location.search).has('agents')

const versionId = (index: number) =>
  `c0000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`

const region = (x: number) => ({
  kind: 'pixels',
  x,
  y: 120,
  width: 300,
  height: 220,
  source_width: 1200,
  source_height: 900,
})

if (agents) {
  Object.assign(batch, {
    evidence_observations: [
      ['e1', 3, 40, ['100nF X7R 50V'], null, 'label', 'read', null],
      ['e2', 3, 420, ['CL21B104KBCNNNC'], null, 'label', 'likely', null],
      ['e3', 9, 60, ['1N4148'], lotId(4), 'handwriting', 'disagree', 200],
      // The same bag again, from closer; "Same item as…" counts it once.
      ['e4', 10, 80, ['1N4148 bag, close'], lotId(4), 'handwriting', 'likely', 200],
    ].map(([id, version, x, markings, lot, sourceKind, agreement, count]) => ({
      id: `e0000000-0000-4000-8000-0000000000${String(id).slice(1).padStart(2, '0')}`,
      evidence_version_id: versionId(version as number),
      page: 1,
      region: region(x as number),
      readings: { markings, source_kind: sourceKind, agreement },
      visible_count: count as number | null,
      status: 'active',
      origin: 'agent',
      agent_session_id: '90000000-0000-4000-8000-000000000001',
      lot_id: lot,
      supersedes_observation_id: null,
      operator_edited: false,
      revision: '1',
      suggested_lot_ids: [],
    })),
    // The diode lot was formed from its photo's region.
    lots: batch.lots.map((lot) =>
      lot.id === lotId(4)
        ? {
            ...lot,
            origin: 'agent',
            evidence_observation_ids: [
              'e0000000-0000-4000-8000-000000000003',
              'e0000000-0000-4000-8000-000000000004',
            ],
          }
        : lot,
    ),
  })
}

const sessionJob = (
  id: string,
  stage: string,
  subject: string | null,
  text: string,
  at: string,
) => ({
  id,
  subject_id: subject,
  stage,
  revision: '1',
  state: 'running',
  attempt_id: id.replace(/^9/, '8'),
  input_sha256: 'a'.repeat(64),
  attempt_number: '1',
  qualification: 'native_unverified',
  session_state: 'running',
  latest_status: { text, at },
  proposals: [],
  questions: [],
})

const processingSnapshot = {
  runner_status: 'native_unverified',
  batch_id: batchId,
  capture_revision: batch.revision,
  cursor: batch.cursor,
  jobs: [
    {
      ...sessionJob(
        '90000000-0000-4000-8000-000000000001',
        'examine',
        null,
        'Grouping the reel photos',
        '2026-11-06T09:05:00.000Z',
      ),
      // Asked before packet B's count, so Needs you lists it first.
      questions: [
        {
          id: 'a0000000-0000-4000-8000-000000000002',
          job_id: '90000000-0000-4000-8000-000000000001',
          attempt_id: '80000000-0000-4000-8000-000000000001',
          input_sha256: 'a'.repeat(64),
          revision: '1',
          state: 'open',
          spec: {
            kind: 'clarification',
            subject_id: null,
            prompt: 'Is the capacitor reel label the same part as the loose capacitors?',
            reason: 'Both read 100nF, but only the reel shows a part number.',
          },
          assumption: 'Treating them as separate lots until answered.',
          asked_at: '2026-11-06T09:02:00.000Z',
        },
      ],
    },
    sessionJob(
      '90000000-0000-4000-8000-000000000002',
      'research',
      lotId(3),
      'Checking the ATmega328P datasheet',
      '2026-11-06T09:06:00.000Z',
    ),
    {
      ...sessionJob(
        '90000000-0000-4000-8000-000000000003',
        'examine',
        lotId(2),
        'Counting Resistor packet B',
        '2026-11-06T09:07:00.000Z',
      ),
      session_state: 'waiting_input',
      questions: [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          job_id: '90000000-0000-4000-8000-000000000003',
          attempt_id: '80000000-0000-4000-8000-000000000003',
          input_sha256: 'a'.repeat(64),
          revision: '1',
          state: 'open',
          spec: {
            kind: 'quantity',
            subject_id: lotId(2),
            prompt: 'How many resistors are in packet B?',
            reason: 'The label is torn where the count is printed.',
          },
          asked_at: '2026-11-06T09:07:00.000Z',
        },
      ],
    },
  ],
}
const processingClient = {
  read: async () => ({ ...processingSnapshot, capture_revision: batch.revision }),
  session: async (_batch: string, jobId: string) => ({
    job_id: jobId,
    attempt_id: jobId.replace(/^9/, '8'),
    session_state: 'running',
    outbox: [],
    inbox: [],
    truncated: false,
  }),
  chat: async () => ({ id: 'f0000000-0000-4000-8000-000000000001' }),
  // An accepted answer settles the question and sets the lot's quantity, as the server does.
  // An accepted answer settles its question; a quantity answer also sets the lot, as the server does.
  answer: async (
    _batch: string,
    questionId: string,
    input: { value: { kind: string; value?: string } },
  ) => {
    // The fixture's jobs differ in shape, so they are read through what an answer touches.
    const jobs = processingSnapshot.jobs as {
      questions: { id: string; spec: { subject_id: string | null } }[]
      session_state: string
    }[]
    const job = jobs.find((item) => item.questions.some((question) => question.id === questionId))
    if (!job) {
      throw new Error('fixture question not found')
    }
    const subject = job.questions.find((question) => question.id === questionId)!.spec.subject_id
    job.questions = job.questions.filter((question) => question.id !== questionId)
    job.session_state = 'running'
    if (input.value.kind === 'quantity' && input.value.value && subject) {
      const value = input.value.value
      batch.lots = batch.lots.map((lot) =>
        lot.id === subject ? { ...lot, quantity: { mode: 'set', value } } : lot,
      )
    }
    batch.revision = String(Number(batch.revision) + 1)
    return { status: 'accepted' }
  },
}

/** List times are relative, so they are set from now to keep the screenshots stable. */
function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

export function BatchCaptureProof() {
  const route = useHashRoute()

  return (
    <ServerStateProvider scope={scope}>
      <GlobalStyle />
      <Masthead
        breadcrumb={
          route ? [{ label: 'Batches', href: '#' }, { label: batch.title }] : [{ label: 'Batches' }]
        }
      />
      <Main>
        {route ? (
          <ApiClientsProvider
            value={{
              media: mediaClient,
              operator: operatorClient as never,
              attention: { read: async () => attention },
              ...(agents ? { processing: processingClient as never } : {}),
            }}
          >
            <Batch
              key={route.split('/')[0]}
              id={batchId}
              route={route}
              client={captureClient as never}
              manual={manualClient as never}
              onDirtyChange={() => {}}
            />
          </ApiClientsProvider>
        ) : (
          <PageContent $width="content">
            <Batches client={captureClient as never} onDirtyChange={() => {}} />
          </PageContent>
        )}
      </Main>
    </ServerStateProvider>
  )
}

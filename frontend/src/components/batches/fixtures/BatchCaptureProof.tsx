import { useEffect, useState } from 'react'
import type {
  BatchAttentionDto,
  CaptureSnapshotDto,
  MediaSnapshotDto,
  MediaVersionDto,
} from '@invimport/contracts'
import { GlobalStyle } from '../../GlobalStyle'
import { Masthead } from '../../masthead/Masthead'
import { ServerStateProvider } from '../../query/ServerStateProvider'
import type { MediaClient } from '../../../media/types'
import { Batch } from '../Batch'
import { Batches } from '../Batches'

const noSteps = {
  examine: { questions: 0, failed: 0 },
  research: { questions: 0, failed: 0 },
  images: { questions: 0, failed: 0 },
  inventory: { questions: 0, failed: 0 },
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
        : [{ page: 1, width: 1200, height: 900, preview_id: `d0000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}` }],
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
    ...(index === 3 ? { note: { text: 'Taken under the magnifier. The last letter is hard to read.' } } : {}),
    versions: [version(index + 1, file.pdf ?? false)],
  })),
  attachments: [],
  derivations: [],
} as unknown as MediaSnapshotDto

const attention: BatchAttentionDto = {
  batch_id: batchId,
  revision: '7',
  processing: { questions: 3, failed: 0, steps: noSteps },
  review: { to_check: 4, changed_after_review: 1, to_decide: 2 },
  changes: { ready: 1, failed: 0, uncertain: 0 },
  items: [
    { key: 'question:q1', group: 'question', tab: 'processing', title: 'Is the last letter of the MCU marking a P?', detail: 'Assuming ATmega328P', route: `${batchId}/processing/examine/q1` },
    { key: 'question:q2', group: 'question', tab: 'processing', title: 'How many diodes are in the bag?', detail: 'Assuming about 200', route: `${batchId}/processing/examine/q2` },
    { key: 'question:q3', group: 'question', tab: 'processing', title: 'Which supplier SKU is the LM358 tube?', detail: null, route: `${batchId}/processing/research/q3` },
    { key: `changed:${lotId(2)}`, group: 'changed_lot', tab: 'review', title: lotNames[1], detail: 'Changed since it was reviewed', route: `${batchId}/review/lots/${lotId(2)}` },
    { key: `decision:${lotId(3)}:part_not_chosen`, group: 'decision', tab: 'review', title: 'Choose the Part for the microcontroller', detail: lotNames[2], route: `${batchId}/review/lots/${lotId(3)}` },
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
            issue(3, 'quantity_required', 'blocking', 'Choose an exact positive quantity for this lot.'),
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

const operatorClient = {
  read: async () => operatorReview,
  dismiss: unsupported,
  bulkEdit: unsupported,
  restructure: unsupported,
  instruct: unsupported,
}

const captureClient = {
  read: async () => batch,
  edit: async () => batch,
  list: async () => ({
    batches: [
      {
        id: batchId,
        title: batch.title,
        revision: batch.revision,
        archived: false,
        updated_at: batch.updated_at,
        source_id: batch.source_id,
        workflow: { lots: 5, ready: 1, needs_review: 3, blocked: 1, approved: 0, open_questions: 3, active_jobs: 1, latest_round: null },
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        title: 'Rockby order 55120',
        revision: '12',
        archived: false,
        updated_at: '2026-10-28T09:00:00Z',
        source_id: batch.source_id,
        workflow: { lots: 6, ready: 0, needs_review: 0, blocked: 0, approved: 6, open_questions: 0, active_jobs: 0, latest_round: null },
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        title: 'Drawer cleanup — loose ICs',
        revision: '2',
        archived: false,
        updated_at: '2026-11-04T09:00:00Z',
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

function useHashRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1))
  useEffect(() => {
    const follow = () => setRoute(location.hash.slice(1))

    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
  }, [])

  return route
}

export function BatchCaptureProof() {
  const route = useHashRoute()

  return (
    <ServerStateProvider scope={scope}>
      <GlobalStyle />
      <Masthead
        breadcrumb={route ? [{ label: 'Batches', href: '#' }, { label: batch.title }] : [{ label: 'Batches' }]}
      />
      <main style={{ maxWidth: 1600, padding: '18px 16px 40px', margin: 'auto' }}>
        {route ? (
          <Batch
            key={route.split('/')[0]}
            id={batchId}
            route={route}
            client={captureClient as never}
            manual={manualClient as never}
            operator={operatorClient as never}
            media={mediaClient}
            attention={{ read: async () => attention }}
            onDirtyChange={() => {}}
          />
        ) : (
          <Batches client={captureClient as never} onDirtyChange={() => {}} />
        )}
      </main>
    </ServerStateProvider>
  )
}

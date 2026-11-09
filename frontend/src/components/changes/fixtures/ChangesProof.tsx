import { useEffect, useState } from 'react'
import type {
  BatchAttentionDto,
  CaptureSnapshotDto,
  ManualPreviewDto,
  ManualRunDto,
  ManualScopeDto,
  PreparationNodeDto,
} from '@invimport/contracts'
import { GlobalStyle } from '#/components/GlobalStyle'
import { Masthead } from '#/components/masthead/Masthead'
import { HeaderStatus } from '#/components/masthead/HeaderStatus'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { Batch } from '#/components/batches/Batch'
import { Main } from '#/components/AppLayout'

/**
 * Owned browser fixture for Changes: an in-memory manual client prepares exactly the ticked lots,
 * approves, and settles a queued round. Nothing reaches an API, provider or InvenTree.
 */
const scope = {
  origin: location.origin,
  actorId: '30000000-0000-4000-8000-000000000003',
  targetId: 'b0000000-0000-4000-8000-00000000000b',
  targetContextId: '40000000-0000-4000-8000-000000000004',
}
const batchId = '10000000-0000-4000-8000-000000000001'

const id = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const lotId = (n: number) => id('5', n)

const partId = (n: number) => id('a', n)

type PartInfo = {
  label: string
  pk: string | null
  category?: string
  records?: [string, string][]
}
const parts: Record<number, PartInfo> = {
  1: {
    label: '10 kΩ thick-film resistor 0603',
    pk: null,
    category: 'Resistors',
    records: [
      ['parameter', 'Resistance: 10 kΩ'],
      ['parameter', 'Composition: Thick film'],
      ['manufacturer_part', 'RC0603FR-0710KL · Yageo'],
      ['supplier_part', '603-RC0603FR-0710KL · Mouser Electronics'],
    ],
  },
  2: {
    label: '100 nF ceramic capacitor 0805',
    pk: null,
    category: 'Capacitors',
    records: [
      ['parameter', 'Composition: Ceramic'],
      ['manufacturer_part', 'C0805C104K5RACTU · KEMET'],
      ['supplier_part', '80-C0805C104K5R · Mouser Electronics'],
    ],
  },
  3: { label: 'ATmega328P microcontroller', pk: null },
  4: { label: '1N4148 small-signal diode', pk: '29' },
  5: { label: 'LM358 dual op-amp', pk: '31' },
}
type LotInfo = { label: string; part: number; quantity: string; location: [string, string] | null }
const lots: Record<number, LotInfo> = {
  1: {
    label: '10 kΩ resistor 0603 — packet A',
    part: 1,
    quantity: '100',
    location: ['43', 'Drawer 43'],
  },
  2: {
    label: '10 kΩ resistor 0603 — packet B',
    part: 1,
    quantity: '250',
    location: ['44', 'Reel shelf'],
  },
  3: {
    label: '100 nF capacitors (cut tape)',
    part: 2,
    quantity: '50',
    location: ['43', 'Drawer 43'],
  },
  4: { label: 'ATmega328P microcontroller', part: 3, quantity: '4', location: null },
  5: { label: '1N4148 diodes (loose)', part: 4, quantity: '120', location: ['43', 'Drawer 43'] },
  6: { label: 'LM358 op-amps (tube)', part: 5, quantity: '10', location: null },
}

const capture = {
  id: batchId,
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  title: 'Mouser 3381-22 + bench bag',
  revision: '9',
  archived: false,
  updated_at: '2026-11-06T09:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  parts: Object.entries(parts).map(([n, info]) => ({
    id: partId(Number(n)),
    label: info.label,
    revision: '1',
    choice: { mode: 'unset' },
  })),
  lots: Object.entries(lots).map(([n, info]) => ({
    id: lotId(Number(n)),
    label: info.label,
    revision: '1',
    contribution_key: id('6', Number(n)),
    part_subject_id: partId(info.part),
    quantity: { mode: 'set', value: info.quantity },
    location: { mode: 'inherit' },
  })),
  notes: [],
  observations: [],
  cursor: { stream_id: '70000000-0000-4000-8000-000000000007', sequence: '0' },
} as unknown as CaptureSnapshotDto

function preview(n: number, selected: number[]): ManualPreviewDto {
  return {
    id: id('c', n),
    batch_id: batchId,
    selected_lot_ids: selected.map(lotId),
    remaining_lot_ids: Object.keys(lots)
      .map(Number)
      .filter((lot) => !selected.includes(lot))
      .map(lotId),
    plan_sha256: 'a'.repeat(64),
    review_fingerprint: 'b'.repeat(64),
    target_revision: '3',
    capability: 'owned-fake-effects/2',
    effects: selected.map((lot) => {
      const info = lots[lot]
      const part = parts[info.part]
      return {
        lot_id: lotId(lot),
        lot_label: info.label,
        part_label: part.label,
        quantity: info.quantity,
        location_id: info.location?.[0] ?? null,
        location_label: info.location?.[1] ?? 'No location',
        contribution_key: id('6', lot),
        barcode: `bi1:20000000:${id('6', lot).slice(0, 8)}`,
        ...(part.pk
          ? { part_id: part.pk }
          : { part_id: null, part_operation_key: id('d', info.part) }),
      }
    }),
  } as unknown as ManualPreviewDto
}

/** The same records the server's tree read lists, for this fixture's preparations. */
function treeFor(shown: ManualPreviewDto): PreparationNodeDto[] {
  const nodes: PreparationNodeDto[] = []

  const add = (
    node: Partial<PreparationNodeDto> & Pick<PreparationNodeDto, 'key' | 'kind' | 'label'>,
  ) => {
    if (!nodes.some((value) => value.key === node.key)) {
      nodes.push({
        state: 'new',
        parent_key: null,
        location_key: null,
        lot_id: null,
        part_subject_id: null,
        detail: null,
        ...node,
      })
    }
  }

  const chosen = shown.selected_lot_ids.map((value) => Number(value.slice(-2)))
  for (const lot of chosen) {
    const part = parts[lots[lot].part]
    if (part.category) {
      add({
        key: `category:${part.category}`,
        kind: 'category',
        label: part.category,
        state: 'exists',
      })
    }
  }
  for (const company of ['Yageo', 'KEMET', 'Mouser Electronics']) {
    if (
      chosen.some((lot) =>
        parts[lots[lot].part].records?.some(([, label]) => label.endsWith(company)),
      )
    ) {
      add({ key: `company:${company}`, kind: 'company', label: company, state: 'exists' })
    }
  }
  for (const lot of chosen) {
    const location = lots[lot].location
    if (location) {
      add({ key: `location:${location[0]}`, kind: 'location', label: location[1], state: 'exists' })
    }
  }
  for (const lot of chosen) {
    const n = lots[lot].part
    const part = parts[n]
    const key = part.pk ? `part:pk:${part.pk}` : `part:${partId(n)}`
    add({
      key,
      kind: 'part',
      label: part.label,
      state: part.pk ? 'exists' : 'new',
      parent_key: part.category ? `category:${part.category}` : null,
      part_subject_id: partId(n),
    })
    for (const [kind, label] of part.records ?? []) {
      add({
        key: `${kind}:${n}:${label}`,
        kind: kind as PreparationNodeDto['kind'],
        label,
        parent_key: key,
        part_subject_id: partId(n),
      })
    }
  }
  for (const lot of chosen) {
    const info = lots[lot]
    const part = parts[info.part]
    add({
      key: `stock:${lotId(lot)}`,
      kind: 'stock_item',
      label: `${info.label} · ${info.quantity}`,
      parent_key: part.pk ? `part:pk:${part.pk}` : `part:${partId(info.part)}`,
      location_key: info.location ? `location:${info.location[0]}` : null,
      lot_id: lotId(lot),
      part_subject_id: partId(info.part),
    })
  }
  // The diode's existing Part gains its photo, so the plan updates that Part.
  const diode = nodes.find((node) => node.key === 'part:pk:29')
  if (diode) {
    diode.state = 'update'
    diode.changes = [{ field: 'Image', before: null, after: `Image for ${parts[4].label}` }]
    add({
      key: 'attachment:diode-photo',
      kind: 'attachment',
      label: `Image for ${parts[4].label}`,
      parent_key: diode.key,
      part_subject_id: partId(4),
    })
  }
  // Lots left out stay in the tree, dimmed, with the reason Review gives.
  for (const [n, info] of Object.entries(lots)) {
    const lot = Number(n)
    if (!chosen.includes(lot)) {
      const part = parts[info.part]
      const key = part.pk ? `part:pk:${part.pk}` : `part:${partId(info.part)}`
      add({
        key: `unticked:${lotId(lot)}`,
        kind: 'stock_item',
        label: info.label,
        state: 'not_ticked',
        detail: lot === 2 ? 'Changed since review' : 'Not ticked',
        parent_key: nodes.some((node) => node.key === key) ? key : null,
        lot_id: lotId(lot),
        part_subject_id: partId(info.part),
      })
    }
  }
  return nodes
}

const operation = (
  lot: number,
  certainty: 'none' | 'confirmed' | 'unknown',
  pk: string | null,
) => ({
  operation_key: lotId(lot),
  lot_id: lotId(lot),
  lot_label: lots[lot].label,
  quantity: lots[lot].quantity,
  certainty,
  remote_pk: pk,
  recovery_allowed: false,
})

const runBase = (n: number) => ({
  run_id: id('e', n),
  approval_id: id('f', n),
  preparation_id: id('c', 90 + n),
  batch_id: batchId,
  revision: '4',
  round_number: String(n),
  approved_at: new Date(Date.UTC(2026, 10, 8, 9, 30 + n * 12)).toISOString(),
  cancellation_requested: false,
  attributed_stock_ids: [] as string[],
  cursor: { stream_id: '70000000-0000-4000-8000-000000000007', sequence: String(n) },
})

let runs: ManualRunDto[] = [
  {
    ...runBase(1),
    state: 'settled_complete',
    effect_certainty: 'confirmed',
    dispatch_state: 'finished',
    confirmed_stock_ids: ['7101'],
    operations: [operation(5, 'confirmed', '7101')],
  },
  {
    ...runBase(2),
    state: 'recovery_required',
    effect_certainty: 'unknown',
    dispatch_state: 'finished',
    confirmed_stock_ids: [],
    attributed_stock_ids: ['7102'],
    operations: [operation(6, 'unknown', '7102')],
    supported_effects: [
      {
        operation_key: id('d', 50),
        part_subject_id: partId(5),
        kind: 'parameter',
        label: 'Create mapped parameter',
        dependencies: [],
        inputs: { template: '205', data: 'Dual' },
        certainty: 'none',
        remote_pks: [],
        verification: null,
        recovery_action: null,
      },
    ],
  },
] as ManualRunDto[]
const added = new Set([5, 6])
const reviewed = new Set([1, 2, 3, 5, 6])
let preparations: ManualPreviewDto[] = [preview(1, [1, 2, 3])]
let counter = 1
let revision = 9

const changed = () => {
  revision += 1
}

const manualClient = {
  workspace: async () => ({
    batch_id: batchId,
    revision: capture.revision,
    supported: true,
    capability: 'owned-fake-effects/2',
    lots: Object.keys(lots).map((key) => {
      const n = Number(key)
      return {
        lot_id: lotId(n),
        reviewed: reviewed.has(n),
        issues: added.has(n)
          ? [
              {
                code: 'original_contribution_already_approved',
                message: 'Already added.',
                lot_id: lotId(n),
                run_id: null,
              },
            ]
          : lots[n].part === 3
            ? [
                {
                  code: 'part_choice_required',
                  message: 'Choose the Part for this lot.',
                  lot_id: lotId(n),
                  run_id: null,
                },
              ]
            : [],
      }
    }),
    runs,
    preparations,
    preparations_truncated: false,
    cursor: { stream_id: '70000000-0000-4000-8000-000000000007', sequence: String(revision) },
  }),
  activity: async () => ({ runs: [], truncated: false }),
  review: async () => {
    throw new Error('fixture review is disabled')
  },
  prepare: async (_batch: string, input: ManualScopeDto) => {
    counter += 1
    const made = preview(
      counter,
      input.selected_lot_ids.map((value) => Number(value.slice(-2))),
    )
    preparations = [made]
    changed()
    return { status: 'prepared' as const, preparation: made }
  },
  tree: async (preparationId: string) => {
    const shown = preparations.find((value) => value.id === preparationId) ?? preview(1, [1, 2, 3])
    return {
      preparation_id: preparationId,
      plan_version: 'bench-effects-plan/2',
      nodes: treeFor(shown),
    }
  },
  approve: async (input: { preparation_id: string }) => {
    const approved = preparations.find((value) => value.id === input.preparation_id)!
    const chosen = approved.selected_lot_ids.map((value) => Number(value.slice(-2)))
    preparations = []
    const round = runs.length + 1
    runs = [
      ...runs,
      {
        ...runBase(round),
        state: 'queued',
        effect_certainty: 'none',
        dispatch_state: 'not_requested',
        confirmed_stock_ids: [],
        operations: chosen.map((lot) => operation(lot, 'none', null)),
      } as ManualRunDto,
    ]
    chosen.forEach((lot) => added.add(lot))
    changed()
    return {
      run_id: runBase(round).run_id,
      approval_id: runBase(round).approval_id,
      preparation_id: approved.id,
    }
  },
  run: async (runId: string) => runs.find((value) => value.run_id === runId)!,
  start: async (runId: string) => {
    runs = runs.map((value, index) =>
      value.run_id === runId
        ? ({
            ...value,
            state: 'settled_complete',
            effect_certainty: 'confirmed',
            dispatch_state: 'finished',
            confirmed_stock_ids: value.operations.map((_, offset) => String(7201 + offset)),
            operations: value.operations.map((item, offset) => ({
              ...item,
              certainty: 'confirmed',
              remote_pk: String(7201 + offset),
            })),
            part_outputs: [
              {
                operation_key: id('d', 1),
                part_subject_id: partId(1),
                label: parts[1].label,
                spec_sha256: 'c'.repeat(64),
                certainty: 'confirmed',
                remote_pks: [String(80 + index)],
                usable: true,
                verification: null,
              },
            ],
          } as ManualRunDto)
        : value,
    )
    changed()
    return { run_id: runId, approval_id: id('f', 3), preparation_id: id('c', 93) }
  },
  cancel: async () => {
    throw new Error('fixture cancel is disabled')
  },
  recover: async () => {
    throw new Error('fixture recovery is disabled')
  },
}

const captureClient = {
  read: async () => capture,
  edit: async () => capture,
  observe: async () => {
    throw new Error('fixture target reads are disabled')
  },
  list: async () => ({ batches: [], truncated: false }),
  create: async () => capture,
}

const identity = {
  actor_id: scope.actorId,
  target_id: scope.targetId,
  target_context_id: scope.targetContextId,
}
const header = {
  connection: async () => ({
    ...identity,
    target: {
      state: 'reachable' as const,
      freshness: 'fresh' as const,
      observed_at: new Date().toISOString(),
      failure_code: null,
      navigation_url: 'https://inventree.example.test/',
      label: 'Test InvenTree',
      kind: 'owned_test' as const,
    },
  }),
  work: async () => ({
    ...identity,
    observed_at: new Date().toISOString(),
    work: [],
    active_sessions: [],
    work_truncated: false,
    sessions_truncated: false,
    lane_occupied: false,
  }),
}

const noSteps = { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 }

const attention = async (): Promise<BatchAttentionDto> => ({
  batch_id: batchId,
  revision: capture.revision,
  processing: {
    questions: 0,
    failed: 0,
    running: 0,
    steps: { examine: noSteps, research: noSteps, images: noSteps, inventory: noSteps },
  },
  review: { to_check: 1, changed_after_review: 0, to_decide: 1, records: 0 },
  changes: {
    ready: preparations.length ? preparations[0].selected_lot_ids.length : 0,
    failed: 0,
    uncertain: runs.filter((run) => run.effect_certainty === 'unknown').length,
    runs: runs.length,
  },
  items: [],
  items_truncated: false,
})

function useHashRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || `${batchId}/changes/ready`)
  useEffect(() => {
    const follow = () => setRoute(location.hash.slice(1))

    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
  }, [])
  return route
}

export function ChangesProof() {
  const route = useHashRoute()
  return (
    <ServerStateProvider scope={scope}>
      <GlobalStyle />
      <Masthead
        breadcrumb={[{ label: 'Batches', href: '#' }, { label: capture.title }]}
        status={<HeaderStatus client={header as never} batchId={batchId} />}
      />
      <Main>
        <Batch
          id={batchId}
          route={route}
          client={captureClient as never}
          manual={manualClient as never}
          attention={{ read: attention }}
          onDirtyChange={() => {}}
        />
      </Main>
    </ServerStateProvider>
  )
}

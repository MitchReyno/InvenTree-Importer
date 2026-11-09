import {
  applyRecordChange,
  projectRecords,
  type BatchAttentionDto,
  type CaptureEditDto,
  type CaptureSnapshotDto,
  type InventoryPartSpecDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import { GlobalStyle } from '#/components/GlobalStyle'
import { Masthead } from '#/components/masthead/Masthead'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { Batch } from '#/components/batches/Batch'
import { Main } from '#/components/AppLayout'
import { useHashRoute } from '#/navigation/useHashRoute'
import { ApiClientsProvider } from '#/components/clients/ApiClientsProvider'

/**
 * Owned browser fixture: an in-memory capture client applies record edits with the shared
 * `applyRecordChange`, and records are projected with the server's `projectRecords`.
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

type Model = 'category' | 'parameter_template' | 'category_parameter' | 'company' | 'part'
const observations: CaptureSnapshotDto['observations'] = []

function observe<M extends Model>(model: M, pk: string, label: string, mapping?: object) {
  const observation = {
    id: id('9', observations.length + 1),
    model,
    pk,
    target_context_id: scope.targetContextId,
    label,
    observed_at: '2026-11-06T09:00:00Z',
    ...(mapping ? { mapping } : {}),
  }
  observations.push(observation as CaptureSnapshotDto['observations'][number])
  return { observation_id: observation.id, target_context_id: scope.targetContextId, model, pk }
}

const template = { kind: 'parameter_template', model_type: 'part.part', enabled: true }
const resistors = observe('category', '81', 'Resistors', { kind: 'category' })
const capacitors = observe('category', '82', 'Capacitors', { kind: 'category' })
observe('category', '83', 'Diodes', { kind: 'category' })
const resistance = observe('parameter_template', '201', 'Resistance', template)
const composition = observe('parameter_template', '202', 'Composition', template)
observe('parameter_template', '203', 'Dielectric', template)
const power = observe('parameter_template', '204', 'Power', template)

const mapping = (pk: string, label: string, category: string, templatePk: string) =>
  observe('category_parameter', pk, label, {
    kind: 'category_parameter',
    category_id: category,
    template_id: templatePk,
  })

const resistorsResistance = mapping('301', 'Resistors · Resistance', '81', '201')
const resistorsComposition = mapping('302', 'Resistors · Composition', '81', '202')
mapping('303', 'Capacitors · Resistance', '82', '201')
const capacitorsComposition = mapping('304', 'Capacitors · Composition', '82', '202')
mapping('305', 'Capacitors · Dielectric', '82', '203')
const resistorsPower = mapping('306', 'Resistors · Power', '81', '204')

const company = (pk: string, label: string, manufacturer: boolean, supplier: boolean) =>
  observe('company', pk, label, { kind: 'company', manufacturer, supplier })

const yageo = company('12', 'Yageo', true, false)
company('13', 'KEMET', true, false)
company('15', 'Global Connector Technology', true, false)
company('14', 'Vishay', true, false)
const mouser = company('21', 'Mouser Electronics', false, true)
company('22', 'DigiKey', false, true)
const existingDiode = observe('part', '29', '1N4148 small-signal diode')
const stocked = observe('part', '31', 'RES 10k 5% 0603')

const resistorSpec: InventoryPartSpecDto = {
  name: '10 kΩ thick-film resistor 0603',
  description: '1%, 0.1 W, 0603 chip',
  category: resistors,
  parameters: [
    { template: resistance, category_mapping: resistorsResistance, value: '10 kΩ' },
    { template: composition, category_mapping: resistorsComposition, value: 'Thick film' },
  ],
  manufacturer: { company: yageo, mpn: 'RC0603FR-0710KL' },
  supplier: { company: mouser, sku: '603-RC0603FR-0710KL' },
  tags: ['SMD', '0603'],
}
const capacitorSpec: InventoryPartSpecDto = {
  name: '100 nF ceramic capacitor 0805',
  category: capacitors,
  parameters: [
    { template: composition, category_mapping: capacitorsComposition, value: 'Ceramic' },
  ],
  // Research proposed a manufacturer the target does not have yet (GCT), so none is set.
  manufacturer: null,
  supplier: { company: mouser, sku: '80-C0805C104K5R' },
  tags: ['SMD'],
}

const part = (n: number, label: string, choice: CaptureSnapshotDto['parts'][number]['choice']) => ({
  id: id('a', n),
  label,
  revision: '1',
  choice,
})

const lot = (n: number, label: string, partN: number) => ({
  id: id('5', n),
  label,
  revision: '1',
  contribution_key: id('6', n),
  part_subject_id: id('a', partN),
  quantity: { mode: 'set' as const, value: String(n * 25) },
  location: { mode: 'inherit' as const },
})

let current: CaptureSnapshotDto = {
  id: batchId,
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  title: 'Mouser 3381-22 + bench bag',
  revision: '7',
  archived: false,
  updated_at: '2026-11-06T09:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  parts: [
    part(1, '10 kΩ resistor', { mode: 'create', spec: resistorSpec }),
    part(2, '100 nF capacitor', { mode: 'create', spec: capacitorSpec }),
    part(3, 'ATmega328P microcontroller', { mode: 'unset' }),
    part(4, '1N4148 diode', { mode: 'set', value: existingDiode }),
  ],
  lots: [
    lot(1, '10 kΩ resistor 0603 — packet A', 1),
    lot(2, '10 kΩ resistor 0603 — packet B', 1),
    lot(3, '100 nF capacitors (cut tape)', 2),
    lot(4, 'ATmega328P microcontroller', 3),
    lot(5, '1N4148 diodes (loose)', 4),
  ],
  notes: [],
  observations,
  cursor: { stream_id: '70000000-0000-4000-8000-000000000007', sequence: '0' },
}

// Research proposed the resistor's category, manufacturer and tags; the operator set the rest.
const processing = {
  jobs: [
    {
      id: id('7', 1),
      subject_id: id('a', 1),
      stage: 'research',
      proposals: [
        {
          id: id('8', 1),
          message_id: id('8', 2),
          value: {
            schema_version: 'bench-intake-proposal/5',
            subject_id: id('a', 1),
            summary: 'Yageo RC0603 thick-film resistor.',
            sources: [],
            tags: ['SMD', '0603'],
            catalogue: {
              category: {
                choice: 'existing',
                reference: resistors,
                sources: [],
                reason: 'the other 0603 resistors live here and share its templates',
                alternative: { name: 'Thick film resistors', reason: 'a new sub-category' },
              },
              not_reused: {
                part: stocked,
                label: 'RES 10k 5% 0603',
                reason: 'Different tolerance.',
              },
              parameters: [
                {
                  name: 'Resistance',
                  template: resistance,
                  category_mapping: resistorsResistance,
                  value: '10 kΩ',
                  sources: [],
                  source_kind: 'label',
                  agreement: 'disagree',
                  // The packet and a distributor page disagree; Research kept both.
                  alternatives: [
                    { value: '10.2 kΩ', sources: [], source_kind: 'distributor_page' },
                  ],
                  chosen_because: 'Using the label.',
                },
              ],
              required_missing: [
                {
                  name: 'Power',
                  template: power,
                  category_mapping: resistorsPower,
                  reason: 'Not in the datasheet pages read.',
                },
              ],
              manufacturer: {
                company: { choice: 'existing', reference: yageo },
                mpn: 'RC0603FR-0710KL',
              },
              supplier: null,
              description: null,
            },
          },
        },
      ],
      questions: [],
      session_state: 'running',
      latest_status: { text: 'Checking the resistor datasheet', at: '2026-11-06T09:06:00.000Z' },
    },
    {
      id: id('8', 3),
      subject_id: id('a', 2),
      stage: 'research',
      session_state: 'running',
      latest_status: { text: 'Reading the capacitor reel label', at: '2026-11-06T09:07:00.000Z' },
      proposals: [
        {
          id: id('8', 4),
          message_id: id('8', 5),
          value: {
            schema_version: 'bench-intake-proposal/5',
            subject_id: id('a', 2),
            summary: 'GCT 100 nF MLCC on a reel.',
            sources: [],
            tags: ['SMD'],
            catalogue: {
              category: {
                choice: 'proposed_new',
                name: 'MLCC capacitors',
                reason: 'The reel label says MLCC.',
                sources: [],
              },
              parameters: [
                {
                  name: 'Voltage',
                  value: '50 V',
                  template: null,
                  category_mapping: null,
                  sources: [],
                },
              ],
              manufacturer: {
                company: {
                  choice: 'proposed_new',
                  name: 'GCT',
                  reason: 'The reel label reads GCT.',
                  sources: [],
                },
                mpn: 'CL21B104KBCNNNC',
                sources: [],
              },
              supplier: {
                company: { choice: 'existing', reference: mouser, sources: [] },
                sku: '80-C0805C104K5R',
                price: { amount: '0.08', currency: 'USD' },
                sources: [],
              },
              description: null,
            },
          },
        },
      ],
      questions: [],
    },
  ],
} as unknown as ProcessingSnapshotDto

function apply(change: CaptureEditDto['change']) {
  let parts = current.parts
  if (change.kind === 'record') {
    const { specs } = applyRecordChange(current, change)
    parts = parts.map((item) =>
      specs.has(item.id)
        ? { ...item, choice: { mode: 'create', spec: specs.get(item.id)! } }
        : item,
    )
  } else if (change.kind === 'part' && change.choice) {
    parts = parts.map((item) =>
      item.id === change.id ? { ...item, choice: change.choice! } : item,
    )
  }
  current = { ...current, parts, revision: String(Number(current.revision) + 1) }
  return current
}

const captureClient = {
  read: async () => current,
  edit: async (_id: string, request: CaptureEditDto) => apply(request.change),
  observe: async () => {
    throw new Error('fixture target reads are disabled')
  },
  list: async () => ({ batches: [], truncated: false }),
  create: async () => current,
}
/** The fixture's InvenTree: each mapped record's current values, as the target would return them. */
const records = {
  read: async () => projectRecords({ capture: current, processing, lotGroups: null }),
  existing: async () => {
    const mapped = projectRecords({ capture: current, processing, lotGroups: null }).records.filter(
      (record) => record.mapped,
    )
    return {
      target_context_id: current.target_context_id,
      records: mapped.slice(0, 50).map((record) => ({
        key: record.key,
        status: 'found' as const,
        fields: [
          { name: 'name', value: record.label },
          {
            name: 'description',
            value: record.type === 'company' ? 'Stocked supplier since 2024' : null,
          },
        ],
      })),
      truncated: mapped.length > 50,
    }
  },
}

const unsupported = async () => {
  throw new Error('fixture commands are disabled')
}

const manualClient = {
  workspace: async () => ({
    batch_id: batchId,
    revision: current.revision,
    supported: true,
    capability: 'owned-fake-stock/1',
    lots: current.lots.map((item) => ({ lot_id: item.id, reviewed: false, issues: [] })),
    runs: [],
    preparations: [],
    preparations_truncated: false,
    cursor: current.cursor,
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
const noSteps = { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 }
const attention: BatchAttentionDto = {
  batch_id: batchId,
  revision: '7',
  processing: {
    questions: 0,
    failed: 0,
    running: 0,
    steps: { examine: noSteps, research: noSteps, images: noSteps, inventory: noSteps },
  },
  review: {
    to_check: 5,
    changed_after_review: 0,
    needs_answer: 0,
    to_decide: 1,
    records: projectRecords({ capture: current, processing, lotGroups: null }).records.length,
  },
  changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
  items: [],
  items_truncated: false,
}

// Ask sends to the session working on the record; the fixture accepts every message.
const processingClient = {
  read: async () => processing,
  session: async () => ({ outbox: [], inbox: [], truncated: false, session_state: 'running' }),
  chat: async () => ({ id: id('f', 1) }),
}

export function RecordsProof() {
  const route = useHashRoute(`${batchId}/review/records`)
  return (
    <ServerStateProvider scope={scope}>
      <GlobalStyle />
      <Masthead breadcrumb={[{ label: 'Batches', href: '#' }, { label: current.title }]} />
      <Main>
        <ApiClientsProvider
          value={{
            processing: processingClient as never,
            attention: { read: async () => attention },
            records,
          }}
        >
          <Batch
            id={batchId}
            route={route}
            client={captureClient as never}
            manual={manualClient as never}
            onDirtyChange={() => {}}
          />
        </ApiClientsProvider>
      </Main>
    </ServerStateProvider>
  )
}

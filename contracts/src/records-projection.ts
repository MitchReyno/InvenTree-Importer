import type { CaptureSnapshotDto } from './capture.ts'
import {
  defaultLocationDraft,
  resolveLotLocation,
  type LotLocationGroups,
} from './capture-location.ts'
import type { InventoryPartSpecDto } from './effects.ts'
import type { ProcessingSnapshotDto } from './processing.ts'
import {
  RECORD_TYPES,
  type BatchRecordDto,
  type BatchRecordsDto,
  type RecordOriginDto,
} from './records.ts'

type Proposal = ProcessingSnapshotDto['jobs'][number]['proposals'][number]
type Unsupported = NonNullable<BatchRecordDto['unsupported']>[number]
type ProposedCompany = NonNullable<BatchRecordDto['proposed']>
type Reference = { observation_id: string; target_context_id: string; model: string; pk: string }
type Choice = { choice: string; name?: string; reason?: string; reference?: Reference }
type Catalogue = {
  category: Choice | null
  parameters: { name: string; value: string; template: Reference | null }[]
  manufacturer: { company: Choice; mpn: string } | null
  supplier: {
    company: Choice
    sku: string | null
    price: { amount: string; currency: string } | null
  } | null
}
type Role = 'manufacturer' | 'supplier'

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/**
 * An observed company a proposed name probably means, by an explicit rule: the same name, its
 * initials, or one name containing the other. Nothing else counts as likely.
 */
type CompanyReference = Omit<Reference, 'model'> & { model: 'company' }

function likelyMatch(
  name: string,
  candidates: { reference: CompanyReference; label: string }[],
): { reference: CompanyReference; label: string; why: string } | null {
  const wanted = words(name).join(' ')
  const rules: [string, (label: string) => boolean][] = [
    ['It has the same name', (label) => words(label).join(' ') === wanted],
    [
      `Its initials are ${name}`,
      (label) =>
        /^[A-Za-z]{2,}$/.test(name) &&
        words(label)
          .map((word) => word[0])
          .join('') === name.toLowerCase(),
    ],
    [
      'Its name contains the other',
      (label) => {
        const other = words(label).join(' ')
        return (
          wanted.length >= 3 &&
          other.length >= 3 &&
          (other.includes(wanted) || wanted.includes(other))
        )
      },
    ],
  ]
  for (const [why, matches] of rules) {
    const found = candidates.find((candidate) => matches(candidate.label))
    if (found) {
      return { ...found, why }
    }
  }
  return null
}

type Step = Extract<RecordOriginDto, { kind: 'step' }>['step']
type Origin = RecordOriginDto
type Field = BatchRecordDto['fields'][number]

const OPERATOR: Origin = { kind: 'operator' }
const ESTIMATE: Origin = { kind: 'estimate', step: 'examine' }

/** Labels joining two values stay within the contract's 256 characters. */
const clip = (text: string) => (text.length > 256 ? `${text.slice(0, 255)}…` : text)

export interface RecordsInput {
  capture: CaptureSnapshotDto
  /** Undefined when Processing is unconfigured or unreadable; origins then read as the operator's. */
  processing: ProcessingSnapshotDto | undefined
  lotGroups: LotLocationGroups | null
}

function stepOf(stage: string): Step {
  return stage === 'research' || stage === 'images' || stage === 'inventory' ? stage : 'examine'
}

type Proposed = { proposal: Proposal; step: Step }

/** Every retained proposal about each subject, with the step that made it. */
function proposalsBySubject(processing: ProcessingSnapshotDto | undefined) {
  const bySubject = new Map<string, Proposed[]>()
  for (const job of processing?.jobs ?? []) {
    for (const proposal of job.proposals) {
      const subject = proposal.value.subject_id
      bySubject.set(subject, [
        ...(bySubject.get(subject) ?? []),
        { proposal, step: stepOf(job.stage) },
      ])
    }
  }
  return bySubject
}

/**
 * A field shows the step of a proposal it still matches. Retained proposals carry no reliable
 * order, so any match counts rather than only the last one read.
 */
function originsFor(spec: InventoryPartSpecDto, proposals: readonly Proposed[]) {
  const each = proposals.map((entry) => originsFromOne(spec, entry))

  const first = (pick: (origins: ReturnType<typeof originsFromOne>) => Origin) =>
    each.map(pick).find((origin) => origin.kind === 'step') ?? OPERATOR

  return {
    category: () => first((origins) => origins.category()),
    tags: () => first((origins) => origins.tags()),
    description: () => first((origins) => origins.description()),
    parameter: (templatePk: string, value: string) =>
      first((origins) => origins.parameter(templatePk, value)),
    manufacturer: () => first((origins) => origins.manufacturer()),
    mpn: () => first((origins) => origins.mpn()),
    supplier: () => first((origins) => origins.supplier()),
    sku: () => first((origins) => origins.sku()),
  }
}

/** Compares a spec's fields with one proposal. */
function originsFromOne(spec: InventoryPartSpecDto, latest: Proposed | undefined) {
  const none = () => OPERATOR

  if (!latest) {
    return {
      category: none,
      tags: none,
      description: none,
      parameter: none,
      manufacturer: none,
      mpn: none,
      supplier: none,
      sku: none,
    }
  }
  const value = latest.proposal.value as Record<string, unknown> & {
    tags?: string[]
    catalogue?: {
      category: { choice: string; reference?: { pk: string } } | null
      parameters: { template: { pk: string } | null; value: string }[]
      manufacturer: { company: { choice: string; reference?: { pk: string } }; mpn: string } | null
      supplier: {
        company: { choice: string; reference?: { pk: string } }
        sku: string | null
      } | null
      description: { text: string } | null
    }
  }
  const step: Origin = { kind: 'step', step: latest.step, proposal_id: latest.proposal.id }

  const when = (matches: boolean) => (matches ? step : OPERATOR)

  const catalogue = value.catalogue

  const existingPk = (item: { choice: string; reference?: { pk: string } } | null | undefined) =>
    item?.choice === 'existing' ? item.reference?.pk : undefined

  const sameTags =
    value.tags !== undefined &&
    value.tags.length === spec.tags.length &&
    spec.tags.every((tag) => value.tags!.includes(tag))
  return {
    category: () => when(existingPk(catalogue?.category) === spec.category.pk),
    tags: () => when(spec.tags.length > 0 && sameTags),
    description: () =>
      when(spec.description !== undefined && catalogue?.description?.text === spec.description),
    parameter: (templatePk: string, parameterValue: string) =>
      when(
        Boolean(
          catalogue?.parameters.some(
            (item) => item.template?.pk === templatePk && item.value === parameterValue,
          ),
        ),
      ),
    manufacturer: () =>
      when(
        spec.manufacturer !== null &&
          existingPk(catalogue?.manufacturer?.company) === spec.manufacturer.company.pk,
      ),
    mpn: () =>
      when(spec.manufacturer !== null && catalogue?.manufacturer?.mpn === spec.manufacturer.mpn),
    supplier: () =>
      when(
        spec.supplier !== null &&
          existingPk(catalogue?.supplier?.company) === spec.supplier.company.pk,
      ),
    sku: () => when(spec.supplier !== null && catalogue?.supplier?.sku === spec.supplier.sku),
  }
}

/** Every record the batch touches, from capture state. Proposed-new values arrive with task 14. */
export function projectRecords({ capture, processing, lotGroups }: RecordsInput): BatchRecordsDto {
  const label = (observationId: string, fallback: string) =>
    capture.observations.find((item) => item.id === observationId)?.label ?? fallback

  const activeLots = capture.lots.filter((lot) => !lot.retired)

  const lotsOf = (partIds: readonly string[]) =>
    activeLots
      .filter((lot) => lot.part_subject_id !== null && partIds.includes(lot.part_subject_id))
      .map((lot) => lot.id)

  const proposals = proposalsBySubject(processing)
  const records: BatchRecordDto[] = []

  const field = (name: string, value: string | null, origin: Origin): Field => ({
    name,
    value: value === null ? null : value.slice(0, 512),
    origin,
  })

  const record = (
    value: Omit<BatchRecordDto, 'fields' | 'decision' | 'lot_ids'> &
      Partial<Pick<BatchRecordDto, 'fields' | 'decision' | 'lot_ids'>>,
  ) =>
    records.push({
      fields: [],
      decision: null,
      lot_ids: lotsOf(value.part_ids),
      ...value,
    })

  const created = capture.parts.flatMap((part) =>
    part.choice.mode === 'create' ? [{ id: part.id, spec: part.choice.spec }] : [],
  )
  // Shared records: one per category, company role and template, listing every Part using it.
  const shared = new Map<
    string,
    {
      type: BatchRecordDto['type']
      label: string
      target: BatchRecordDto['target']
      parts: string[]
    }
  >()

  const share = (
    key: string,
    type: BatchRecordDto['type'],
    recordLabel: string,
    target: BatchRecordDto['target'],
    partId: string,
  ) => {
    const current = shared.get(key) ?? { type, label: recordLabel, target, parts: [] }
    if (!current.parts.includes(partId)) {
      current.parts.push(partId)
    }
    shared.set(key, current)
  }

  for (const { id, spec } of created) {
    share(
      `category:${spec.category.pk}`,
      'category',
      label(spec.category.observation_id, `Category ${spec.category.pk}`),
      null,
      id,
    )
    for (const role of ['manufacturer', 'supplier'] as const) {
      const company = spec[role]?.company
      if (company) {
        share(
          `company:${role}:${company.pk}`,
          'company',
          label(company.observation_id, `Company ${company.pk}`),
          { kind: 'company', role, pk: company.pk },
          id,
        )
      }
    }
    for (const parameter of spec.parameters) {
      share(
        `parameter_template:${parameter.template.pk}`,
        'parameter_template',
        label(parameter.template.observation_id, `Template ${parameter.template.pk}`),
        { kind: 'parameter_template', pk: parameter.template.pk },
        id,
      )
    }
    for (const tag of spec.tags) {
      share(`tag:${tag}`, 'tag', tag, null, id)
    }
  }
  for (const [key, value] of shared) {
    record({
      key,
      type: value.type,
      label: value.label,
      // Mapped records already exist; tags are applied to the Parts the batch creates.
      state: value.type === 'tag' ? 'update' : 'exists',
      target: value.target,
      part_ids: value.parts,
    })
  }

  for (const part of capture.parts) {
    if (part.choice.mode === 'create') {
      const spec = part.choice.spec
      // A lot's proposal can set its Part's values (suggested tags), so those count too.
      const origin = originsFor(
        spec,
        [part.id, ...lotsOf([part.id])].flatMap((subject) => proposals.get(subject) ?? []),
      )
      record({
        key: `part:${part.id}`,
        type: 'part',
        label: spec.name,
        state: 'new',
        target: { kind: 'part', part_subject_id: part.id },
        part_ids: [part.id],
        fields: [
          field('name', spec.name, OPERATOR),
          field('description', spec.description ?? null, origin.description()),
          field(
            'category',
            label(spec.category.observation_id, spec.category.pk),
            origin.category(),
          ),
          field('tags', spec.tags.length ? spec.tags.join(', ') : null, origin.tags()),
        ],
      })
      if (spec.manufacturer) {
        record({
          key: `manufacturer_part:${part.id}`,
          type: 'manufacturer_part',
          label: clip(`${spec.manufacturer.mpn} · ${spec.name}`),
          state: 'new',
          target: { kind: 'manufacturer_part', part_subject_id: part.id },
          part_ids: [part.id],
          fields: [
            field(
              'company',
              label(spec.manufacturer.company.observation_id, spec.manufacturer.company.pk),
              origin.manufacturer(),
            ),
            field('mpn', spec.manufacturer.mpn, origin.mpn()),
          ],
        })
      }
      if (spec.supplier) {
        record({
          key: `supplier_part:${part.id}`,
          type: 'supplier_part',
          label: clip(`${spec.supplier.sku} · ${spec.name}`),
          state: 'new',
          target: { kind: 'supplier_part', part_subject_id: part.id },
          part_ids: [part.id],
          fields: [
            field(
              'company',
              label(spec.supplier.company.observation_id, spec.supplier.company.pk),
              origin.supplier(),
            ),
            field('sku', spec.supplier.sku, origin.sku()),
          ],
        })
      }
      for (const parameter of spec.parameters) {
        const templateLabel = label(parameter.template.observation_id, parameter.template.pk)
        record({
          key: `parameter:${part.id}:${parameter.template.pk}`,
          type: 'parameter',
          label: clip(`${templateLabel}: ${parameter.value}`),
          state: 'new',
          target: {
            kind: 'parameter',
            part_subject_id: part.id,
            template_pk: parameter.template.pk,
          },
          part_ids: [part.id],
          fields: [
            field(
              'value',
              parameter.value,
              origin.parameter(parameter.template.pk, parameter.value),
            ),
          ],
        })
      }
    } else if (part.choice.mode === 'set') {
      record({
        key: `part:${part.id}`,
        type: 'part',
        label: label(part.choice.value.observation_id, part.label),
        state: 'exists',
        target: null,
        part_ids: [part.id],
      })
    } else {
      // Unset, unknown or cleared: no Part is chosen yet.
      record({
        key: `part:${part.id}`,
        type: 'part',
        label: part.label,
        state: 'choose',
        target: null,
        part_ids: [part.id],
        decision: {
          code: 'part_choice_required',
          detail: 'Choose an existing Part or start a new one.',
        },
      })
    }
  }

  // Catalogue proposals: values the executor cannot create are shown, never written into a spec.
  const catalogueOf = (subjects: string[]) =>
    subjects
      .flatMap((subject) => proposals.get(subject) ?? [])
      .map((entry) => (entry.proposal.value as { catalogue?: Catalogue }).catalogue)
      .find((catalogue): catalogue is Catalogue => Boolean(catalogue))

  const observedCompanies = (role: Role) =>
    capture.observations.flatMap((item) =>
      item.model === 'company' &&
      (item.mapping as { manufacturer?: boolean; supplier?: boolean } | undefined)?.[role]
        ? [
            {
              reference: {
                observation_id: item.id,
                target_context_id: item.target_context_id,
                model: 'company' as const,
                pk: item.pk,
              },
              label: item.label,
            },
          ]
        : [],
    )

  const proposedCompanies = new Map<
    string,
    { company: Omit<ProposedCompany, 'likely'>; parts: string[] }
  >()
  for (const part of capture.parts) {
    const catalogue = catalogueOf([part.id, ...lotsOf([part.id])])
    if (!catalogue) {
      continue
    }
    const unsupported: Unsupported[] = []
    if (catalogue.category?.choice === 'proposed_new' && catalogue.category.name) {
      unsupported.push({
        field: 'category',
        value: clip(catalogue.category.name),
        why: 'Creating a category is not supported yet; choose an existing category.',
        reason: catalogue.category.reason?.slice(0, 512) || null,
      })
    }
    for (const parameter of catalogue.parameters) {
      if (parameter.template === null) {
        unsupported.push({
          field: 'parameter',
          value: clip(`${parameter.name}: ${parameter.value}`),
          why: 'Creating a parameter template is not supported yet.',
          reason: null,
        })
      }
    }
    if (catalogue.supplier?.price) {
      unsupported.push({
        field: 'supplier',
        value: `${catalogue.supplier.price.amount} ${catalogue.supplier.price.currency}`,
        why: 'Supplier prices are not supported yet.',
        reason: null,
      })
    }
    const partRecord = records.find((item) => item.key === `part:${part.id}`)
    if (partRecord && unsupported.length) {
      partRecord.unsupported = unsupported.slice(0, 40)
    }
    const spec = part.choice.mode === 'create' ? part.choice.spec : null
    for (const role of ['manufacturer', 'supplier'] as const) {
      const entry = catalogue[role]
      // A role the Part already has is the operator's choice; it is not asked about again.
      if (
        !entry ||
        entry.company.choice !== 'proposed_new' ||
        !entry.company.name ||
        spec?.[role]
      ) {
        continue
      }
      const key = `${role}:${words(entry.company.name).join('-')}`
      const known = proposedCompanies.get(key)
      if (known) {
        known.parts.push(part.id)
        continue
      }
      proposedCompanies.set(key, {
        company: {
          role,
          name: clip(entry.company.name),
          reason: entry.company.reason?.slice(0, 512) || null,
          number: ('mpn' in entry ? entry.mpn : entry.sku)?.slice(0, 256) || null,
        },
        parts: [part.id],
      })
    }
  }
  for (const [key, { company, parts }] of proposedCompanies) {
    record({
      key: `company:proposed:${key}`,
      type: 'company',
      label: company.name,
      state: 'choose',
      target: null,
      part_ids: parts,
      decision: {
        code: 'company_proposed_new',
        detail: `Creating a ${company.role} is not supported yet. Use an existing company or pick another.`,
      },
      proposed: { ...company, likely: likelyMatch(company.name, observedCompanies(company.role)) },
    })
  }

  // Locations group active lots by where they resolve; a lot with none needs a decision.
  const locations = new Map<
    string,
    {
      label: string
      lots: string[]
      state: BatchRecordDto['state']
      decision: BatchRecordDto['decision']
    }
  >()

  const place = (
    key: string,
    value: Omit<NonNullable<ReturnType<typeof locations.get>>, 'lots'>,
    lotId: string,
  ) => {
    const current = locations.get(key) ?? { ...value, lots: [] }
    current.lots.push(lotId)
    locations.set(key, current)
  }

  // The batch default may be a new location draft while the default stays unset, as approval reads it.
  const locationDraft = defaultLocationDraft(capture)

  for (const lot of activeLots) {
    const resolved = resolveLotLocation(capture, lot, lotGroups)
    if (resolved.status === 'conflict') {
      place(
        'location:conflict',
        {
          label: 'Conflicting locations',
          state: 'choose',
          decision: {
            code: 'location_conflict',
            detail: 'Evidence groups give different locations.',
          },
        },
        lot.id,
      )
    } else if (resolved.status === 'groups_unavailable') {
      place(
        'location:unavailable',
        {
          label: 'Location not yet known',
          state: 'choose',
          decision: {
            code: 'location_groups_unavailable',
            detail: 'These lots’ locations wait until evidence groups can be read.',
          },
        },
        lot.id,
      )
    } else if (resolved.location.mode === 'set') {
      const value = resolved.location.value
      place(
        `location:${value.pk}`,
        {
          label: label(value.observation_id, `Location ${value.pk}`),
          state: 'exists',
          decision: null,
        },
        lot.id,
      )
    } else if (locationDraft && resolved.source === 'batch' && resolved.location.mode === 'unset') {
      place(
        `location:draft:${locationDraft.draftId}`,
        {
          label: clip(locationDraft.value.name),
          ...(locationDraft.parentValid
            ? { state: 'new', decision: null }
            : {
                state: 'choose',
                decision: {
                  code: 'location_draft_parent_invalid',
                  detail: 'Choose this new location’s parent again in Capture.',
                },
              }),
        },
        lot.id,
      )
    } else if (resolved.location.mode !== 'clear') {
      place(
        'location:none',
        {
          label: 'No location',
          state: 'choose',
          decision: { code: 'location_required', detail: 'Set a location for these lots.' },
        },
        lot.id,
      )
    }
  }
  for (const [key, value] of locations) {
    records.push({
      key,
      type: 'location',
      label: value.label,
      state: value.state,
      target: null,
      fields: [],
      part_ids: [],
      lot_ids: value.lots,
      decision: value.decision,
    })
  }

  // A lot that inherits takes the batch default, as approval does.
  const quantityOf = (quantity: (typeof activeLots)[number]['quantity']) => {
    const resolved = quantity.mode === 'inherit' ? capture.defaults.quantity : quantity
    return resolved.mode === 'set' ? resolved.value : null
  }

  const partIds = new Set(capture.parts.map((part) => part.id))
  for (const lot of activeLots) {
    // An AI lot's count is only an estimate until the operator accepts or replaces it on the lot,
    // so it never takes the batch default, as approval reads it.
    const inheritsEstimate = lot.origin === 'agent' && lot.quantity.mode === 'inherit'
    const estimated = inheritsEstimate && lot.estimated_quantity !== undefined
    const quantity = inheritsEstimate ? (lot.estimated_quantity ?? null) : quantityOf(lot.quantity)
    const hasPart = lot.part_subject_id !== null && partIds.has(lot.part_subject_id)
    // One decision per record: a lot needs its Part before its quantity matters.
    const decision = !hasPart
      ? { code: 'part_choice_required' as const, detail: 'Choose the Part for this lot.' }
      : estimated
        ? {
            code: 'quantity_required' as const,
            detail: 'Accept or replace the estimated quantity on this lot before approving it.',
          }
        : quantity === null
          ? { code: 'quantity_required' as const, detail: 'Set an exact quantity for this lot.' }
          : null
    records.push({
      key: `stock_item:${lot.id}`,
      type: 'stock_item',
      label: lot.label,
      state: decision ? 'choose' : 'new',
      target: null,
      fields: [field('quantity', quantity, estimated ? ESTIMATE : OPERATOR)],
      part_ids: hasPart ? [lot.part_subject_id!] : [],
      lot_ids: [lot.id],
      decision,
    })
  }

  const order = new Map<string, number>(RECORD_TYPES.map((type, index) => [type, index]))
  records.sort(
    (left, right) =>
      order.get(left.type)! - order.get(right.type)! ||
      (left.type === 'tag' ? left.label.localeCompare(right.label) : 0),
  )
  return {
    batch_id: capture.id,
    revision: capture.revision,
    counts: RECORD_TYPES.map((type) => {
      const ofType = records.filter((item) => item.type === type)
      return {
        type,
        new: ofType.filter((item) => item.state === 'new').length,
        existing: ofType.filter((item) => item.state === 'exists' || item.state === 'update')
          .length,
        decide: ofType.filter((item) => item.state === 'choose' || item.state === 'unsupported')
          .length,
      }
    }),
    records,
  }
}

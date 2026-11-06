import { SUPPORTED_EFFECTS_MANIFEST } from '../src/execution/effects-capability.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { canonical } from '@invimport/contracts/json'
import {
  validate,
  type CaptureObservationDto,
  type InventoryPartSpecDto,
} from '@invimport/contracts'
import { sha256 } from '../src/db/authority.ts'
import {
  decodeEffectsPlan,
  logicalEffectKey,
  partEffects,
  partSpecDigest,
  EFFECTS_BUILD,
  EFFECTS_CAPABILITY,
  type EffectsPlan,
} from '../src/execution/effects-plan.ts'
import { attributedPks, supportedResponseEvidence } from '../src/execution/effects-apply.ts'
import { contributionBarcode } from '../src/execution/plan.ts'
import { validatePartSpec } from '../src/capture/part-spec.ts'
import { planCapacityIssue } from '../src/review/preparations.ts'

function fixture() {
  const context = randomUUID()
  const source = randomUUID()
  const subject = randomUUID()
  const category = {
    observation_id: randomUUID(),
    target_context_id: context,
    model: 'category' as const,
    pk: '81',
  }
  const spec: InventoryPartSpecDto = {
    name: 'Counted resistor',
    category,
    parameters: [],
    manufacturer: null,
    supplier: null,
    tags: [],
  }
  const part = { subjectId: subject, spec, specDigest: partSpecDigest(spec), prior: null }
  const contribution = randomUUID()
  const plan: EffectsPlan = {
    version: 'bench-effects-plan/1',
    build: EFFECTS_BUILD,
    capability: EFFECTS_CAPABILITY,
    deploymentId: randomUUID(),
    targetId: randomUUID(),
    contextId: context,
    epoch: randomUUID(),
    continuity: 'owned-test',
    sourceId: source,
    originalSourceKey: source,
    mediaConfigured: false,
    manifestDigest: sha256(canonical(SUPPORTED_EFFECTS_MANIFEST)).toString('hex'),
    parts: [part],
    partAttachments: [],
    effects: partEffects(part),
    operations: [
      {
        operationKey: randomUUID(),
        contributionKey: contribution,
        part: null,
        partOperationKey: logicalEffectKey(subject, 'create_part'),
        location: null,
        quantity: '9007199254740.123456',
        barcode: contributionBarcode(source, contribution),
      },
    ],
    evidence: [],
    attachments: [],
    mediaInputsDigest: 'a'.repeat(64),
  }
  return { plan, spec, context, category }
}

function decode(plan: unknown) {
  const bytes = Buffer.from(canonical(plan))
  return decodeEffectsPlan(bytes, sha256(bytes))
}

test('versioned effects plan retains one logical Part output and exact stock strings', () => {
  const { plan } = fixture()
  assert.deepEqual(decode(plan), plan)
  const invalid = [
    { ...plan, extra: true },
    { ...plan, effects: [] },
    { ...plan, operations: [{ ...plan.operations[0], partOperationKey: randomUUID() }] },
    { ...plan, operations: [{ ...plan.operations[0], part: '93' }] },
    { ...plan, operations: [plan.operations[0], plan.operations[0]] },
    {
      ...plan,
      parts: [{ ...plan.parts[0], spec: { ...plan.parts[0].spec, tags: ['SMD', 'smd'] } }],
    },
  ]
  for (const changed of invalid) {
    assert.throws(() => decode(changed))
  }
})

test('public stock preview rejects impossible null/producer unions', () => {
  const effect = {
    lot_id: randomUUID(),
    lot_label: 'A',
    part_label: 'New Part',
    quantity: '1',
    location_id: null,
    location_label: 'No location',
    contribution_key: randomUUID(),
    barcode: 'literal',
  }
  assert.throws(() => validate('ManualEffect', { ...effect, part_id: null }))
  assert.throws(() =>
    validate('ManualEffect', { ...effect, part_id: '93', part_operation_key: randomUUID() }),
  )
  validate('ManualEffect', { ...effect, part_id: null, part_operation_key: randomUUID() })
  validate('ManualEffect', { ...effect, part_id: '93' })
})

test('malformed sibling identities cannot discard attributable exact PKs', () => {
  assert.deepEqual(
    attributedPks([
      { pk: '9007199254740993' },
      { pk: 0 },
      { pk: '17' },
      { pk: '9007199254740993' },
      { pk: 'not-an-id' },
      { pk: 9007199254740992 },
    ]),
    ['9007199254740993', '17'],
  )
})

test('mapped observations require exact context, category and company semantic role', () => {
  const { spec, context, category } = fixture()
  const observed = {
    id: category.observation_id,
    model: 'category' as const,
    pk: category.pk,
    target_context_id: context,
    label: 'Resistors',
    observed_at: 'fixture',
    mapping: { kind: 'category' as const },
  }
  validatePartSpec(spec, context, [observed])
  assert.throws(() => validatePartSpec(spec, randomUUID(), [observed]))
  assert.throws(() =>
    validatePartSpec(
      {
        ...spec,
        manufacturer: {
          company: {
            observation_id: observed.id,
            target_context_id: context,
            model: 'company',
            pk: '81',
          },
          mpn: 'R1',
        },
      },
      context,
      [observed],
    ),
  )
})

test('exact response bytes retain more than32 attributable IDs and unsafe siblings never confirm', async () => {
  const { supportedResponseEvidence } = await import('../src/execution/effects-apply.ts')
  const pks = Array.from({ length: 100 }, (_, index) => String(index + 1))
  const bytes = Buffer.from(
    `[${pks.map((pk) => `{"pk":"${pk}"}`).join(',')},{"pk":9007199254740993},{"pk":0}]`,
  )
  assert.deepEqual(supportedResponseEvidence(201, bytes, { name: 'Resistor' }), {
    pks,
    confirmed: false,
  })
  assert.deepEqual(
    supportedResponseEvidence(
      201,
      Buffer.from('{"pk":"9007199254740993","name":"Resistor","unsafe":9007199254740993}'),
      { name: 'Resistor' },
    ),
    { pks: ['9007199254740993'], confirmed: false },
  )
  assert.deepEqual(
    supportedResponseEvidence(201, Buffer.from('{"pk":"9007199254740993","name":"Resistor"}'), {
      name: 'Resistor',
    }),
    { pks: ['9007199254740993'], confirmed: true },
  )
  assert.throws(() =>
    supportedResponseEvidence(201, Buffer.from('{"pk":"17","p\\u006b":"18"}'), {}),
  )
})

test('every parameter citing a category mapping must use that mapping template', () => {
  const { spec, context, category } = fixture()
  const observation = (
    model: 'category' | 'parameter_template' | 'category_parameter',
    pk: string,
    mapping: CaptureObservationDto['mapping'],
  ) => ({
    id: randomUUID(),
    model,
    pk,
    target_context_id: context,
    label: `${model} ${pk}`,
    observed_at: 'fixture',
    mapping,
  })
  const categoryObserved = {
    ...observation('category', category.pk, { kind: 'category' }),
    id: category.observation_id,
  }
  const enabled = {
    kind: 'parameter_template' as const,
    model_type: 'part.part' as const,
    enabled: true,
  }
  const first = observation('parameter_template', '11', enabled)
  const second = observation('parameter_template', '12', enabled)
  const mapping = observation('category_parameter', '31', {
    kind: 'category_parameter',
    category_id: category.pk,
    template_id: first.pk,
  })
  const reference = <M extends 'parameter_template' | 'category_parameter'>(
    observed: { id: string; pk: string },
    model: M,
  ) => ({
    observation_id: observed.id,
    target_context_id: context,
    model,
    pk: observed.pk,
  })
  const parameter = (template: typeof first, value: string) => ({
    template: reference(template, 'parameter_template'),
    category_mapping: reference(mapping, 'category_parameter'),
    value,
  })
  const observations = [categoryObserved, first, second, mapping]
  validatePartSpec({ ...spec, parameters: [parameter(first, '10k')] }, context, observations)
  assert.throws(
    () =>
      validatePartSpec(
        { ...spec, parameters: [parameter(first, '10k'), parameter(second, '1%')] },
        context,
        observations,
      ),
    { code: 'parameter_category_incompatible' },
  )
})

test('selected Part attachment freezes exact media and destination without pulling another subject or primary image', async () => {
  const { partDestinationKey, partTransferEffects } =
    await import('../src/execution/part-attachment-plan.ts')
  const { plan } = fixture()
  const part = plan.parts[0]
  const versionId = randomUUID()
  const version = {
    versionId,
    evidenceId: randomUUID(),
    blobDigest: 'b'.repeat(64),
    byteSize: '73',
    mediaType: 'image/png' as const,
    kind: 'original' as const,
    originalVersionId: versionId,
    originalDigest: 'b'.repeat(64),
    recipeDigest: null,
  }
  const transfer = {
    artifactKey: randomUUID(),
    partSubjectId: part.subjectId,
    destinationKey: partDestinationKey(part.subjectId, null, part),
    part: null,
    partOperationKey: logicalEffectKey(part.subjectId, 'create_part'),
    version,
    prior: null,
  }
  const selected = {
    ...plan,
    mediaConfigured: true,
    evidence: [version],
    partAttachments: [transfer],
    effects: [...plan.effects, ...partTransferEffects([transfer])],
  }
  assert.deepEqual(decode(selected), selected)
  assert.throws(() =>
    decode({ ...selected, partAttachments: [{ ...transfer, partSubjectId: randomUUID() }] }),
  )
  assert.throws(() =>
    decode({ ...selected, partAttachments: [{ ...transfer, part: '93', partOperationKey: null }] }),
  )
  assert.throws(() =>
    decode({ ...selected, partAttachments: [{ ...transfer, destinationKey: 'primary_image' }] }),
  )
  assert.throws(() => decode({ ...selected, evidence: [] }))
  assert.throws(() => decode({ ...selected, mediaConfigured: false }))
})

test('blank, control, overlong and excessive tag names refuse; distinct Unicode names remain distinct', () => {
  const { plan, spec, context, category } = fixture()
  const observations = [
    {
      id: category.observation_id,
      model: 'category' as const,
      pk: '81',
      target_context_id: context,
      observed_at: '2020-01-01T00:00:00.000Z',
      label: 'Resistors',
      mapping: { kind: 'category' as const },
    },
  ]
  const planned = (tags: string[]) => {
    const next = { ...spec, tags }
    const part = { ...plan.parts[0], spec: next, specDigest: partSpecDigest(next) }
    return { ...plan, parts: [part], effects: partEffects(part) }
  }
  for (const tags of [[], ['SMD']] as const) {
    validatePartSpec({ ...spec, tags: [...tags] }, context, observations)
    assert.deepEqual(decode(planned([...tags])), planned([...tags]))
  }
  for (const tags of [
    [''],
    [' '],
    ['\n'],
    ['a'.repeat(101)],
    Array.from({ length: 33 }, (_, index) => `tag-${index}`),
  ]) {
    assert.throws(() => validate('InventoryPartSpec', { ...spec, tags }))
  }
  const { tags: _absent, ...withoutTags } = spec
  assert.throws(() => validate('InventoryPartSpec', withoutTags))
  for (const tags of [['\u0001'], ['safe\u0001'], ['\u007f']]) {
    validate('InventoryPartSpec', { ...spec, tags })
    assert.throws(() => decode(planned(tags)), /unsupported_part_spec/)
    assert.throws(() => validatePartSpec({ ...spec, tags }, context, observations))
  }
  const distinct = planned(['Ω', 'ω'])
  assert.deepEqual(decode(distinct), distinct)
})

test('native new tag names are part of the create spec; case-duplicate ASCII names refuse', () => {
  const { plan, spec, context, category } = fixture()
  const named = { ...spec, tags: ['SMD', 'Bench intake new tag'] }
  validate('InventoryPartSpec', named)
  validatePartSpec(named, context, [
    {
      id: category.observation_id,
      model: 'category',
      pk: '81',
      target_context_id: context,
      observed_at: '2020-01-01T00:00:00.000Z',
      label: 'Resistors',
      mapping: { kind: 'category' },
    },
  ])
  const duplicate = { ...spec, tags: ['SMD', 'smd'] }
  const part = { ...plan.parts[0], spec: duplicate, specDigest: partSpecDigest(duplicate) }
  assert.throws(() => decode({ ...plan, parts: [part], effects: partEffects(part) }))
})

test('create confirmation keeps extra observed tags and every trustworthy identity', () => {
  const body = {
    name: 'Shared resistor Ω',
    category: '81',
    tags: ['SMD', 'Bench intake new tag'],
    copy_category_parameters: false,
  }
  const confirmed = Buffer.from(
    JSON.stringify({
      pk: 8101,
      name: body.name,
      category: body.category,
      tags: [...body.tags, 'added-later'],
      copy_category_parameters: false,
    }),
  )
  assert.deepEqual(supportedResponseEvidence(201, confirmed, body), {
    pks: ['8101'],
    confirmed: true,
  })
  const missing = Buffer.from(
    JSON.stringify({
      pk: 8101,
      name: body.name,
      category: body.category,
      copy_category_parameters: false,
    }),
  )
  assert.deepEqual(supportedResponseEvidence(201, missing, body), {
    pks: ['8101'],
    confirmed: false,
  })
  assert.deepEqual(attributedPks([{ pk: '8101' }, { pk: 'invalid' }, { pk: '7777' }]), [
    '8101',
    '7777',
  ])
})

test('an oversized supported-effects selection is a typed capacity issue, not a decoder failure', () => {
  const { plan } = fixture()
  assert.equal(planCapacityIssue(plan), null)
  const effects = Array.from({ length: 101 }, () => plan.effects[0])
  assert.equal(planCapacityIssue({ ...plan, effects })?.code, 'effects_capacity')
  const operations = Array.from({ length: 11 }, () => plan.operations[0])
  assert.equal(planCapacityIssue({ ...plan, operations })?.code, 'effects_capacity')
  const parts = Array.from({ length: 11 }, () => plan.parts[0])
  assert.equal(planCapacityIssue({ ...plan, parts })?.code, 'effects_capacity')
  const oversized = { ...plan.parts[0].spec, name: 'x'.repeat(270000) }
  assert.equal(
    planCapacityIssue({ ...plan, parts: [{ ...plan.parts[0], spec: oversized }] })?.code,
    'effects_capacity',
  )
})

test('a frozen spec without a description keeps its digests; a description joins the Part create', () => {
  const frozen: InventoryPartSpecDto = {
    name: 'Frozen resistor',
    category: {
      observation_id: '0b6f9a52-4e1d-4c1a-9f65-000000000901',
      target_context_id: '0b6f9a52-4e1d-4c1a-9f65-000000000001',
      model: 'category',
      pk: '81',
    },
    parameters: [],
    manufacturer: null,
    supplier: null,
    tags: ['SMD'],
  }
  const subjectId = '0b6f9a52-4e1d-4c1a-9f65-000000000010'
  const binding = (spec: InventoryPartSpecDto) => ({
    subjectId,
    spec,
    specDigest: partSpecDigest(spec),
    prior: null,
  })
  // Digests recorded before descriptions existed; an unset description must not move them.
  assert.equal(
    partSpecDigest(frozen),
    '663c48e050f09561b92cefda7e4f0305e496c5aac5164f3b3e7b78b657b265df',
  )
  assert.equal(
    sha256(canonical(partEffects(binding(frozen)))).toString('hex'),
    '6741c7cc5da9de14f74ca5689dd84f56ac9ddc771b6a4cf3fc1de6a5cc3ebb2f',
  )

  const described = { ...frozen, description: 'Through-hole, 1/4 W' }
  const create = partEffects(binding(described)).find((effect) => effect.kind === 'create_part')!
  assert.equal(create.input.description, 'Through-hole, 1/4 W')
  assert.notEqual(partSpecDigest(described), partSpecDigest(frozen))
  const { plan } = fixture()
  const withDescription = {
    ...plan,
    parts: [binding(described)],
    effects: partEffects(binding(described)),
    operations: [
      { ...plan.operations[0], partOperationKey: logicalEffectKey(subjectId, 'create_part') },
    ],
  }
  assert.deepEqual(decode(withDescription), withDescription)
})

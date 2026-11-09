import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../src/db/authority.ts'
import { contributionBarcode } from '../src/execution/plan.ts'
import { effectsManifestDigestFor } from '../src/execution/effects/effects-capability.ts'
import {
  EFFECTS_BUILD,
  EFFECTS_CAPABILITY,
  RECORD_EFFECTS_BUILD,
  RECORD_EFFECTS_CAPABILITY,
  companyCreateKey,
  decodeEffectsPlan,
  locationCreateKey,
  recordEffects,
  recordSpecDigest,
  type CompanyBinding,
  type EffectsPlan,
  type LocationBinding,
} from '../src/execution/effects/effects-plan.ts'

function fixture() {
  const source = randomUUID()
  const locationDraft = randomUUID()
  const companyDraft = randomUUID()
  const locationSpec = { name: 'Shelf C', description: 'Reels', parent: '12' }
  const companySpec = {
    name: 'Acme Reels',
    description: '',
    isManufacturer: true,
    logo: null,
  }
  const location: LocationBinding = {
    draftId: locationDraft,
    spec: locationSpec,
    specDigest: recordSpecDigest(locationSpec),
    prior: null,
  }
  const company: CompanyBinding = {
    draftId: companyDraft,
    spec: companySpec,
    specDigest: recordSpecDigest(companySpec),
    prior: null,
  }
  const contribution = randomUUID()
  const plan: EffectsPlan = {
    version: 'bench-effects-plan/2',
    build: RECORD_EFFECTS_BUILD,
    capability: RECORD_EFFECTS_CAPABILITY,
    deploymentId: randomUUID(),
    targetId: randomUUID(),
    contextId: randomUUID(),
    epoch: randomUUID(),
    continuity: 'owned-test',
    sourceId: source,
    originalSourceKey: source,
    mediaConfigured: false,
    manifestDigest: effectsManifestDigestFor('bench-effects-plan/2'),
    parts: [],
    partAttachments: [],
    locations: [location],
    companies: [company],
    effects: recordEffects([location], [company]),
    operations: [
      {
        operationKey: randomUUID(),
        contributionKey: contribution,
        part: '29',
        partOperationKey: null,
        location: null,
        locationOperationKey: locationCreateKey(locationDraft),
        quantity: '4',
        barcode: contributionBarcode(source, contribution),
      },
    ],
    evidence: [],
    attachments: [],
    mediaInputsDigest: 'a'.repeat(64),
  }
  return { plan, location, company }
}

function decode(plan: unknown) {
  const bytes = Buffer.from(canonical(plan))
  return decodeEffectsPlan(bytes, sha256(bytes))
}

test('a /2 plan derives location and supplier creates from typed drafts before any stock', () => {
  const { plan, location, company } = fixture()
  assert.deepEqual(decode(plan), plan)
  assert.deepEqual(
    plan.effects.map((effect) => [effect.kind, effect.operationKey, effect.dependencies]),
    [
      ['create_location', locationCreateKey(location.draftId), []],
      ['create_company', companyCreateKey(company.draftId), []],
    ],
  )
  assert.deepEqual(plan.effects[1].input, {
    name: 'Acme Reels',
    description: '',
    is_supplier: 'true',
    is_manufacturer: 'true',
    image: '',
  })
})

test('a /2 plan refuses ambiguous, missing, unconsumed or rewritten record bindings', () => {
  const { plan, location, company } = fixture()
  const operation = plan.operations[0]
  const cases: [unknown, RegExp][] = [
    [{ ...plan, build: EFFECTS_BUILD }, /unsupported_effects_plan/],
    [{ ...plan, capability: EFFECTS_CAPABILITY }, /unsupported_effects_plan/],
    [
      { ...plan, manifestDigest: effectsManifestDigestFor('bench-effects-plan/1') },
      /capability_manifest_mismatch/,
    ],
    [{ ...plan, operations: [{ ...operation, location: '12' }] }, /ambiguous_location_identity/],
    [
      { ...plan, operations: [{ ...operation, locationOperationKey: randomUUID() }] },
      /location_output_missing/,
    ],
    [
      { ...plan, operations: [{ ...operation, locationOperationKey: null, location: '12' }] },
      /unselected_location_effect/,
    ],
    [
      { ...plan, locations: [{ ...location, spec: { ...location.spec, name: 'Shelf D' } }] },
      /unsupported_record_spec/,
    ],
    [
      {
        ...plan,
        locations: [
          {
            ...location,
            spec: { ...location.spec, name: '  ' },
            specDigest: recordSpecDigest({ ...location.spec, name: '  ' }),
          },
        ],
      },
      /unsupported_record_spec/,
    ],
    [{ ...plan, companies: [company, company] }, /unsupported_record_spec/],
    [{ ...plan, effects: plan.effects.slice(1) }, /effect_index_mismatch/],
    [
      {
        ...plan,
        effects: [
          { ...plan.effects[0], input: { ...plan.effects[0].input, parent: '99' } },
          plan.effects[1],
        ],
      },
      /effect_index_mismatch/,
    ],
  ]
  for (const [value, error] of cases) {
    assert.throws(() => decode(value), error)
  }
})

test('/1 plans cannot carry record fields, and a company logo needs approved media', () => {
  const { plan, company } = fixture()
  const { locations: _locations, companies: _companies, ...v1Fields } = plan
  assert.throws(
    () =>
      decode({
        ...v1Fields,
        locations: [],
        companies: [],
        version: 'bench-effects-plan/1',
        build: EFFECTS_BUILD,
        capability: EFFECTS_CAPABILITY,
        manifestDigest: effectsManifestDigestFor('bench-effects-plan/1'),
      }),
    /invalid_effects_plan/,
  )
  const logo = {
    versionId: randomUUID(),
    evidenceId: randomUUID(),
    blobDigest: 'b'.repeat(64),
    byteSize: '68',
    mediaType: 'image/png' as const,
    kind: 'original' as const,
    originalVersionId: '',
    originalDigest: 'b'.repeat(64),
    recipeDigest: null,
  }
  logo.originalVersionId = logo.versionId
  const withLogo = { ...company.spec, logo }
  const logoCompany = { ...company, spec: withLogo, specDigest: recordSpecDigest(withLogo) }
  const effects = recordEffects(plan.locations!, [logoCompany])
  assert.equal(effects[1].input.image, logo.versionId)
  assert.throws(
    () => decode({ ...plan, companies: [logoCompany], effects }),
    /unconfigured_approved_media/,
  )
  assert.throws(
    () => decode({ ...plan, mediaConfigured: true, companies: [logoCompany], effects }),
    /company_logo_evidence_missing/,
  )
  assert.deepEqual(
    decode({ ...plan, mediaConfigured: true, companies: [logoCompany], effects, evidence: [logo] })
      .companies?.[0].spec.logo,
    logo,
  )
})

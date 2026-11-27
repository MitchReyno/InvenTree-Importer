import type { CaptureSnapshotDto, ExamineIdentityV1Dto, MatchKeyDto } from '@invimport/contracts'

/** A lot's identity carries at most this many keys into a search. */
export const MAX_MATCH_KEYS = 32
const KEY_MAX_CHARACTERS = 100

/**
 * How Match compares part numbers: case and whitespace are ignored, punctuation is kept, since
 * `1N4148W-7-F` and `1N4148W7F` can be different orderable parts.
 */
export function mpnKey(value: string) {
  return value.normalize('NFKC').toUpperCase().replace(/\s+/g, '')
}

const COMPANY_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'limited',
  'llc',
  'gmbh',
  'ag',
  'sa',
  'plc',
  'nv',
  'bv',
  'semiconductor',
  'semiconductors',
  'electronics',
  'technology',
  'technologies',
  'international',
  'group',
])

/** A company name as Match compares it: case-folded words without legal or trade suffixes. */
export function companyKey(name: string) {
  const words = name
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) {
    words.pop()
  }
  return words.join('')
}

/** Two company names agree when their keys are equal or one starts the other (three or more). */
export function companiesAgree(left: string, right: string) {
  const a = companyKey(left)
  const b = companyKey(right)
  if (!a || !b) {
    return false
  }
  if (a === b) {
    return true
  }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 3 && longer.startsWith(shorter)
}

/** Whether a key alone can find the lot's Part: an MPN or type with its maker, NSN, IPN or SKU. */
export function strongKey(key: MatchKeyDto) {
  switch (key.kind) {
    case 'mpn':
      return key.manufacturer !== undefined || key.manufacturer_pk !== undefined
    case 'type':
    case 'nsn':
    case 'ipn':
    case 'sku':
      return true
    case 'batch_code':
      return false
  }
}

export function searchable(keys: readonly MatchKeyDto[]) {
  return keys.some(strongKey)
}

/** Trimmed text a key can carry, or nothing when it is blank or too long to search with. */
function keyText(value: string | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, ' ')
  if (!trimmed || [...trimmed].length > KEY_MAX_CHARACTERS || /[\x00-\x1f\x7f]/.test(trimmed)) {
    return undefined
  }
  return trimmed
}

function identityOf(key: MatchKeyDto) {
  switch (key.kind) {
    case 'mpn':
      return `mpn:${mpnKey(key.mpn)}:${key.manufacturer_pk ?? companyKey(key.manufacturer ?? '')}`
    case 'type':
      return `type:${mpnKey(key.type)}:${companyKey(key.manufacturer)}`
    case 'nsn':
      return `nsn:${key.nsn}`
    case 'ipn':
      return `ipn:${mpnKey(key.ipn)}`
    case 'sku':
      return `sku:${mpnKey(key.sku)}:${key.supplier_pk ?? companyKey(key.supplier ?? '')}`
    case 'batch_code':
      return `batch:${key.batch_code}`
  }
}

/** Keys without repeats, in first-seen order, within the search's bound. */
export function distinctKeys(keys: readonly MatchKeyDto[]) {
  const seen = new Set<string>()
  const kept: MatchKeyDto[] = []
  for (const key of keys) {
    const id = identityOf(key)
    if (seen.has(id) || kept.length >= MAX_MATCH_KEYS) {
      continue
    }
    seen.add(id)
    kept.push(key)
  }
  return kept
}

/** Keys from one of an Examine identity's ranked candidates. */
function candidateKeys(
  candidate: ExamineIdentityV1Dto['candidates'][number],
  maker: string | undefined,
): MatchKeyDto[] {
  const manufacturer = keyText(candidate.manufacturer) ?? maker
  const mpn = keyText(candidate.mpn)
  if (mpn) {
    return [{ kind: 'mpn', mpn, ...(manufacturer ? { manufacturer } : {}) }]
  }
  const type = keyText(candidate.type)
  if (type && manufacturer) {
    return [{ kind: 'type', type, manufacturer }]
  }
  return []
}

/** A match note's key, for the kinds Match searches by. */
function noteKey(
  note: NonNullable<ExamineIdentityV1Dto['match_notes']>[number],
  maker: string | undefined,
): MatchKeyDto[] {
  const value = keyText(note.key?.value)
  if (!note.key || !value || note.kind === 'negative') {
    return []
  }
  switch (note.key.kind) {
    case 'mpn':
      return [{ kind: 'mpn', mpn: value, ...(maker ? { manufacturer: maker } : {}) }]
    case 'nsn':
      return /^[0-9]{4}-[0-9]{2}-[0-9]{3}-[0-9]{4}$/.test(value)
        ? [{ kind: 'nsn', nsn: value }]
        : []
    case 'ipn':
      return [{ kind: 'ipn', ipn: value }]
    case 'sku':
      return [{ kind: 'sku', sku: value }]
    case 'batch_code':
      return [{ kind: 'batch_code', batch_code: value }]
    // Aliases Match doesn't search by alone: a maker, house numbers, codes and cross-references.
    case 'manufacturer':
    case 'house_number':
    case 'packaging_code':
    case 'distributor_code':
    case 'cross_reference':
    case 'alternate_marking':
      return []
  }
}

/**
 * The keys an Examine identity offers Match: each candidate's MPN (with the candidate's or the
 * lot's maker) or type with a maker, a visible NSN, and the keys of its match notes.
 */
export function examineKeys(identity: ExamineIdentityV1Dto): MatchKeyDto[] {
  const maker = keyText(identity.maker?.name)
  const keys: MatchKeyDto[] = identity.candidates.flatMap((candidate) =>
    candidateKeys(candidate, maker),
  )
  if (identity.nsn) {
    keys.push({ kind: 'nsn', nsn: identity.nsn })
  }
  for (const note of identity.match_notes ?? []) {
    keys.push(...noteKey(note, maker))
  }
  return distinctKeys(keys)
}

type Lot = CaptureSnapshotDto['lots'][number]

/** A lot the operator added with no evidence for Examine, whose identity is theirs. */
export function operatorLot(lot: Lot) {
  return (
    lot.retired !== true && lot.origin !== 'agent' && !(lot.evidence_observation_ids ?? []).length
  )
}

/**
 * The identifiers the operator confirmed for a lot of theirs, from its draft Part: the
 * manufacturer's MPN and the supplier's SKU, with the companies they chose. A name with no
 * manufacturer may be the MPN, but alone it isn't a strong key.
 */
export function operatorKeys(snapshot: CaptureSnapshotDto, lot: Lot): MatchKeyDto[] {
  const part = snapshot.parts.find((candidate) => candidate.id === lot.part_subject_id)
  if (!part || part.choice.mode !== 'create') {
    return []
  }
  const spec = part.choice.spec

  const companyName = (observationId: string) =>
    snapshot.observations.find((observation) => observation.id === observationId)?.label

  const keys: MatchKeyDto[] = []
  const mpn = keyText(spec.manufacturer?.mpn)
  if (spec.manufacturer && mpn) {
    const manufacturer = keyText(companyName(spec.manufacturer.company.observation_id))
    keys.push({
      kind: 'mpn',
      mpn,
      ...(manufacturer ? { manufacturer } : {}),
      manufacturer_pk: spec.manufacturer.company.pk,
    })
  }
  const sku = keyText(spec.supplier?.sku)
  if (spec.supplier && sku) {
    const supplier = keyText(companyName(spec.supplier.company.observation_id))
    keys.push({
      kind: 'sku',
      sku,
      ...(supplier ? { supplier } : {}),
      supplier_pk: spec.supplier.company.pk,
    })
  }
  const name = keyText(spec.name)
  if (!keys.length && name) {
    keys.push({ kind: 'mpn', mpn: name })
  }
  return distinctKeys(keys)
}

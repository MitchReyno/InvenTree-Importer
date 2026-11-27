import Fuse from 'fuse.js'

export type RankableReference = { pk: string; name: string; secondary: readonly string[] }
export type RankTier = 'exact_id' | 'exact_name' | 'prefix' | 'fuzzy' | 'browse'
export type RankedReference<T extends RankableReference> = { record: T; tier: RankTier }

/** Folds case, accents and whitespace for matching only; labels are never rewritten. */
export function normalizeReferenceText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const FUZZY_MIN_QUERY = 3
const FUZZY_THRESHOLD = 0.4

/**
 * Exact ID, exact name and name-prefix tiers precede Fuse suggestions, where name matches precede
 * secondary-only matches; ties keep numeric ID order. A numeric query matches IDs only, so it can never substitute another record.
 */
export function rankReferences<T extends RankableReference>(
  records: readonly T[],
  query: string,
): RankedReference<T>[] {
  const q = normalizeReferenceText(query)
  if (!q) {
    return records.map((record) => ({ record, tier: 'browse' }))
  }

  // PKs are exact decimal strings; BigInt keeps 64-bit IDs ordered exactly.
  const byId = (a: T, b: T) => {
    const left = BigInt(a.pk)
    const right = BigInt(b.pk)
    return left < right ? -1 : left > right ? 1 : 0
  }

  if (/^\d+$/.test(q)) {
    return records
      .filter((record) => record.pk === q)
      .map((record) => ({ record, tier: 'exact_id' }))
  }
  const names = new Map(records.map((record) => [record, normalizeReferenceText(record.name)]))
  const exact = records.filter((record) => names.get(record) === q).sort(byId)
  const prefix = records
    .filter((record) => names.get(record) !== q && names.get(record)!.startsWith(q))
    .sort(byId)
  const seen = new Set<T>([...exact, ...prefix])
  const fuzzy =
    q.length < FUZZY_MIN_QUERY
      ? []
      : new Fuse(
          records.map((record) => ({
            record,
            name: names.get(record)!,
            secondary: record.secondary.map(normalizeReferenceText),
          })),
          {
            keys: [
              { name: 'name', weight: 3 },
              { name: 'secondary', weight: 1 },
            ],
            threshold: FUZZY_THRESHOLD,
            ignoreLocation: true,
            includeScore: true,
            includeMatches: true,
          },
        )
          .search(q)
          .filter((match) => !seen.has(match.item.record))
          // A name match always precedes a match found only in secondary fields.
          .map((match) => ({
            match,
            secondaryOnly: !match.matches?.some((item) => item.key === 'name'),
          }))
          .sort(
            (a, b) =>
              Number(a.secondaryOnly) - Number(b.secondaryOnly) ||
              a.match.score! - b.match.score! ||
              byId(a.match.item.record, b.match.item.record),
          )
          .map(({ match }) => match)
          .map((match) => match.item.record)
  return [
    ...exact.map((record) => ({ record, tier: 'exact_name' as const })),
    ...prefix.map((record) => ({ record, tier: 'prefix' as const })),
    ...fuzzy.map((record) => ({ record, tier: 'fuzzy' as const })),
  ]
}

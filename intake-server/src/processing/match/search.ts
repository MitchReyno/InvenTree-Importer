import type { Pool } from 'pg'
import { strictJson } from '@invimport/contracts/json'
import type {
  CaptureSnapshotDto,
  MatchCandidateDto,
  MatchContributionHitDto,
  MatchKeyDto,
  MatchMissingDto,
  MatchPartCandidateDto,
  MatchQuestionNoteDto,
  MatchReasonDto,
} from '@invimport/contracts'
import { MAX_MATCH_CANDIDATES, MAX_MATCH_CANDIDATE_STOCK, validate } from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type {
  MatchCategory,
  MatchManufacturerPart,
  MatchPart,
  MatchReader,
  MatchRecordResult,
} from '#/inventory/match-reads.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { companiesAgree, mpnKey, searchable, strongKey } from './keys.ts'
import { competingLots, contributionApprovals } from './local-reads.ts'
import { verdictOf, type MatchResult } from './outcome.ts'
import type { MatchRequest } from './state.ts'

/** Rows one read returns, the transport's largest page. */
const SEARCH_PAGE = 100
/**
 * Rows a search reads under one key, in pages; a key matching more is too vague to decide on,
 * so the search settles as unavailable rather than as no match.
 */
const SEARCH_MAX_ROWS = 500
/** The transport's bound on a text filter, in code points. */
const MATCH_FILTER_MAX_CHARACTERS = 100
/** The contract quotes at most 16 reasons per candidate. */
const MAX_MATCHED_BY = 16
/** Category depth walked for inherited parameter mappings. */
const MAX_CATEGORY_DEPTH = 16
/** One search's reads must finish within this budget, or it settles as unavailable. */
export const MATCH_SEARCH_BUDGET_MS = 30_000

/** A read that failed: the whole search settles as couldn't search. */
class Unavailable extends Error {}

interface Hit {
  part: MatchPart
  matched: { key: MatchKeyDto; reason: MatchReasonDto }[]
  exact: boolean
}

function budgeted(deadline: number) {
  const left = deadline - Date.now()
  if (left < 1) {
    throw new Unavailable()
  }
  return Math.min(left, 5000)
}

async function rows<T>(
  read: Promise<{ kind: 'found'; rows: T[]; count: number } | { kind: 'unavailable' }>,
) {
  const result = await read
  if (result.kind !== 'found') {
    throw new Unavailable()
  }
  return result
}

type Page = { limit: number; offset: number }

/**
 * Every row a list read matches, page by page. Partial results never stand for the whole: a read
 * matching more than `SEARCH_MAX_ROWS`, or one that fails, makes the search unavailable.
 */
async function everyRow<T>(
  read: (
    page: Page,
  ) => Promise<{ kind: 'found'; rows: T[]; count: number } | { kind: 'unavailable' }>,
) {
  const found: T[] = []
  for (;;) {
    const page = await rows(read({ limit: SEARCH_PAGE, offset: found.length }))
    if (page.count > SEARCH_MAX_ROWS) {
      throw new Unavailable()
    }
    found.push(...page.rows)
    if (found.length >= page.count) {
      return { rows: found, count: page.count }
    }
    // A page that brings nothing while rows remain is a read that changed or failed part-way.
    if (!page.rows.length) {
      throw new Unavailable()
    }
  }
}

function add(
  hits: Map<string, Hit>,
  part: MatchPart,
  key: MatchKeyDto,
  reason: MatchReasonDto,
  exact: boolean,
) {
  const hit = hits.get(part.pk) ?? { part, matched: [], exact: false }
  if (hit.matched.length < MAX_MATCHED_BY) {
    hit.matched.push({ key, reason })
  }
  hit.exact = hit.exact || exact
  hits.set(part.pk, hit)
}

/**
 * The spellings of a part number Match compares as the same, for InvenTree's exact filter: as
 * given, without whitespace, and upper case without whitespace.
 */
function mpnSpellings(mpn: string) {
  const compact = mpn.replace(/\s+/g, '')
  // Upper-casing can lengthen text (ß becomes SS); a spelling past the filter's bound isn't asked.
  return [...new Set([mpn, compact, compact.toUpperCase()])].filter(
    (spelling) => [...spelling].length <= MATCH_FILTER_MAX_CHARACTERS,
  )
}

/** The Parts InvenTree holds under one strong key, and how each matched. */
async function searchKey(
  reader: MatchReader,
  key: MatchKeyDto,
  hits: Map<string, Hit>,
  deadline: number,
) {
  switch (key.kind) {
    case 'mpn':
    case 'type': {
      const mpn = key.kind === 'mpn' ? key.mpn : key.type
      // InvenTree's MPN filter is exact, so each spelling Match treats as the same is asked for.
      const found: MatchManufacturerPart[] = []
      for (const spelling of mpnSpellings(mpn)) {
        const read = await everyRow((page) =>
          reader.list(
            {
              kind: 'list_manufacturer_parts',
              ...page,
              // Every maker's: one with another maker is still a possible match.
              mpn: spelling,
            },
            budgeted(deadline),
          ),
        )
        found.push(...read.rows.filter((row) => !found.some((seen) => seen.pk === row.pk)))
      }
      for (const row of found) {
        if (!row.MPN || mpnKey(row.MPN) !== mpnKey(mpn)) {
          continue
        }
        const agrees =
          key.kind === 'mpn' && key.manufacturer_pk
            ? row.manufacturer === key.manufacturer_pk
            : key.manufacturer !== undefined &&
              companiesAgree(row.manufacturer_name, key.manufacturer)
        const reason =
          key.kind === 'type'
            ? 'type_and_manufacturer'
            : agrees
              ? 'mpn_and_manufacturer'
              : 'mpn_only'
        add(hits, row.part_detail, key, reason, agrees)
      }
      // A Part named by its type or MPN, with no manufacturer Part, is a possible match.
      const named = await everyRow((page) =>
        reader.list({ kind: 'search_parts', ...page, search: mpn }, budgeted(deadline)),
      )
      for (const part of named.rows) {
        if (mpnKey(part.name) === mpnKey(mpn) && !hits.has(part.pk)) {
          add(hits, part, key, 'name', false)
        }
      }
      return
    }
    case 'nsn': {
      const found = await everyRow((page) =>
        reader.list({ kind: 'list_stock', ...page, nsn_tag: `nsn:${key.nsn}` }, budgeted(deadline)),
      )
      for (const stock of found.rows) {
        const part =
          stock.part_detail ?? (await single(withinBudget(reader.part(stock.part), deadline)))
        if (part) {
          add(hits, part, key, 'nsn_stock_tag', true)
        }
      }
      return
    }
    case 'ipn': {
      const found = await everyRow((page) =>
        reader.list({ kind: 'search_parts', ...page, search: key.ipn }, budgeted(deadline)),
      )
      for (const part of found.rows) {
        if (part.IPN && mpnKey(part.IPN) === mpnKey(key.ipn)) {
          add(hits, part, key, 'ipn', true)
        }
      }
      return
    }
    case 'sku': {
      const found = await everyRow((page) =>
        reader.list(
          {
            kind: 'list_supplier_parts',
            ...page,
            sku: key.sku,
            ...(key.supplier_pk ? { supplier: key.supplier_pk } : {}),
          },
          budgeted(deadline),
        ),
      )
      for (const row of found.rows) {
        if (mpnKey(row.SKU) !== mpnKey(key.sku)) {
          continue
        }
        const agrees = key.supplier_pk
          ? row.supplier === key.supplier_pk
          : key.supplier === undefined || companiesAgree(row.supplier_name, key.supplier)
        add(hits, row.part_detail, key, 'sku', agrees)
      }
      return
    }
    case 'batch_code':
      return
  }
}

/** A candidate the contract refuses, such as a stock quantity it can't hold, can't be searched. */
function requireCandidate(candidate: MatchCandidateDto) {
  try {
    validate('MatchCandidate', candidate)
  } catch {
    throw new Unavailable()
  }
}

/** A single read within the search's remaining budget; past it, the search is unavailable. */
async function withinBudget<T>(read: Promise<T>, deadline: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Unavailable()), budgeted(deadline))
  })
  try {
    return await Promise.race([read, expiry])
  } finally {
    clearTimeout(timer)
  }
}

async function single<T>(
  read: Promise<{ kind: 'found'; value: T } | { kind: 'not_found' } | { kind: 'unavailable' }>,
) {
  const result = await read
  if (result.kind === 'unavailable') {
    throw new Unavailable()
  }
  return result.kind === 'found' ? result.value : undefined
}

/** Whether an attachment is a datasheet: its comment, file or link says so. */
function datasheet(attachment: {
  attachment: string | null
  link: string | null
  comment: string | null
}) {
  return [attachment.comment, attachment.attachment, attachment.link].some(
    (text) => text !== null && /datasheet/i.test(text),
  )
}

/**
 * The key parameters a Part lacks: its category's mappings, and those of the category's
 * ancestors, that have no value row on the Part. Unknown when the category can't be read, its
 * ancestry is deeper than the walk, or it has more mappings than one response holds; then none
 * is listed as missing.
 */
async function missingParameters(reader: MatchReader, part: MatchPart, deadline: number) {
  if (!part.category) {
    return { known: true, missing: [] as MatchMissingDto[] }
  }
  const chain = new Set<string>()
  let next: string | null = part.category
  while (next) {
    // An ancestry deeper than the walk, or one that loops, leaves mappings unread.
    if (chain.size >= MAX_CATEGORY_DEPTH || chain.has(next)) {
      return { known: false, missing: [] }
    }
    const category: MatchRecordResult<MatchCategory> = await withinBudget(
      reader.category(next),
      deadline,
    )
    if (category.kind !== 'found') {
      return { known: false, missing: [] }
    }
    chain.add(category.value.pk)
    next = category.value.parent
  }
  const mappings = await reader.list(
    { kind: 'list_category_parameters', category: part.category },
    budgeted(deadline),
  )
  if (mappings.kind !== 'found') {
    return { known: false, missing: [] }
  }
  const values = await everyRow((page) =>
    reader.list({ kind: 'list_part_parameters', part: part.pk, ...page }, budgeted(deadline)),
  )
  const filled = new Set(
    values.rows.filter((row) => row.data.trim() !== '').map((row) => row.template),
  )
  const templates = [
    ...new Set(
      mappings.rows
        .filter((mapping) => chain.has(mapping.category))
        .map((mapping) => mapping.template),
    ),
  ].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
  return {
    known: true,
    missing: templates
      .filter((template) => !filled.has(template))
      .map((template): MatchMissingDto => ({ kind: 'parameter', template })),
  }
}

/**
 * What InvenTree lacks for one candidate Part, and its stock with the lot's batch codes; nothing
 * when the Part has gone since it was listed.
 */
async function candidate(
  reader: MatchReader,
  hit: Hit,
  keys: readonly MatchKeyDto[],
  supplierPk: string | undefined,
  deadline: number,
): Promise<MatchPartCandidateDto | undefined> {
  // A Part the list named but its own read can't find is gone: never offered to add stock to.
  const part = await single(withinBudget(reader.part(hit.part.pk), deadline))
  if (!part) {
    return undefined
  }
  const missing: MatchMissingDto[] = []
  const attachments = await everyRow((page) =>
    reader.list({ kind: 'list_part_attachments', part: part.pk, ...page }, budgeted(deadline)),
  )
  if (!attachments.rows.some(datasheet)) {
    missing.push({ kind: 'datasheet' })
  }
  if (!part.has_image) {
    missing.push({ kind: 'part_image' })
  }
  const manufacturer = await rows(
    reader.list(
      { kind: 'list_manufacturer_parts', part: part.pk, limit: 1, offset: 0 },
      budgeted(deadline),
    ),
  )
  if (!manufacturer.count) {
    missing.push({ kind: 'manufacturer_part' })
  }
  if (supplierPk) {
    const supplier = await rows(
      reader.list(
        { kind: 'list_supplier_parts', part: part.pk, supplier: supplierPk, limit: 1, offset: 0 },
        budgeted(deadline),
      ),
    )
    if (!supplier.count) {
      missing.push({ kind: 'supplier_part' })
    }
  }
  const parameters = await missingParameters(reader, part, deadline)
  missing.push(...parameters.missing)
  const stock: MatchPartCandidateDto['stock'] = []
  for (const key of keys) {
    if (key.kind !== 'batch_code' || stock.length >= MAX_MATCH_CANDIDATE_STOCK) {
      continue
    }
    // Read in full, so a short page can't hide stock with the batch code.
    const found = await everyRow((page) =>
      reader.list(
        { kind: 'list_stock', part: part.pk, batch: key.batch_code, ...page },
        budgeted(deadline),
      ),
    )
    for (const row of found.rows) {
      if (
        row.batch &&
        stock.length < MAX_MATCH_CANDIDATE_STOCK &&
        !stock.some((item) => item.pk === row.pk)
      ) {
        stock.push({
          pk: row.pk,
          batch: row.batch,
          quantity: row.quantity,
        })
      }
    }
  }
  return {
    kind: 'part',
    part: {
      pk: part.pk,
      name: part.name,
      ...(part.IPN ? { ipn: part.IPN } : {}),
      has_image: part.has_image,
    },
    verdict: stock.length ? 'duplicate' : hit.exact ? 'exact' : 'possible',
    matched_by: hit.matched,
    missing,
    parameters_known: parameters.known,
    stock,
  }
}

/** The supplier the batch names, which a candidate should have a supplier Part for. */
function batchSupplierPk(snapshot: CaptureSnapshotDto) {
  const latest = (snapshot.context ?? [])
    .filter((record) => record.subject_id === null)
    .sort((a, b) => (BigInt(a.version) < BigInt(b.version) ? 1 : -1))[0]
  const supplier = latest?.value.supplier
  return supplier?.mode === 'set' ? supplier.value.pk : undefined
}

/** Match notes of the Examine identity searched, quoted in the question. */
async function identityNotes(pool: Pool, request: MatchRequest): Promise<MatchQuestionNoteDto[]> {
  if (request.identity.kind !== 'examine') {
    return []
  }
  const found = await pool.query<{ value_bytes: Buffer }>(
    'SELECT value_bytes FROM public.processing_proposal WHERE id=$1',
    [request.identity.proposal_id],
  )
  const value = found.rows[0]
    ? (strictJson(found.rows[0].value_bytes.toString('utf8')) as {
        match_notes?: { kind: 'alias' | 'relation' | 'negative'; text: string }[]
      })
    : undefined
  return (value?.match_notes ?? [])
    .slice(0, 32)
    .map((note) => ({ stage: 'examine', kind: note.kind, text: note.text }))
}

/** The hit's status as the operator may see it: the run and its stock only when readable. */
async function contributionHit(
  pool: Pool,
  config: ProcessingConfig,
  reader: MatchReader | undefined,
  lotId: string,
): Promise<MatchContributionHitDto | undefined> {
  const approvals = await transaction(pool, (client) =>
    contributionApprovals(client, config, lotId),
  )
  if (!approvals.length) {
    return undefined
  }
  const readable = approvals.find((approval) => approval.readable)
  if (!readable) {
    return { readable: false }
  }
  if (readable.confirmedStock.length) {
    if (!reader) {
      return {
        readable: true,
        run_id: readable.runId,
        batch_id: readable.batchId,
        stock: 'unavailable',
      }
    }
    const stock = await reader.stock(readable.confirmedStock[0])
    const state =
      stock.kind === 'found' ? 'created' : stock.kind === 'not_found' ? 'deleted' : 'unavailable'
    return { readable: true, run_id: readable.runId, batch_id: readable.batchId, stock: state }
  }
  return {
    readable: true,
    run_id: readable.runId,
    batch_id: readable.batchId,
    stock: readable.uncertain ? 'uncertain' : 'not_created',
  }
}

/**
 * Runs one request's reads, outside any transaction: the import reference in this app's retained
 * approvals first, then, for a searchable identity, InvenTree by each strong key and the other
 * batches' lots. A failed InvenTree read makes the whole result unavailable.
 */
export function matchSearch(
  pool: Pool,
  config: ProcessingConfig,
  reader: MatchReader | undefined,
  budgetMs = MATCH_SEARCH_BUDGET_MS,
) {
  return async (request: MatchRequest): Promise<MatchResult> => {
    const base = {
      schema_version: 'bench-intake-match-result/1' as const,
      lot_id: request.lot_id,
      generation: request.generation,
      target_context_id: config.targetContextId,
      keys: request.keys,
      notes: await identityNotes(pool, request),
    }
    const contribution = await contributionHit(pool, config, reader, request.lot_id)
    if (contribution) {
      return { ...base, searched: 'local_only', candidates: [], contribution, verdict: 'duplicate' }
    }
    if (!searchable(request.keys)) {
      return { ...base, searched: 'local_only', candidates: [], verdict: 'none' }
    }
    if (!reader) {
      return { ...base, searched: 'unavailable', candidates: [], verdict: 'none' }
    }
    const deadline = Date.now() + budgetMs
    try {
      const hits = new Map<string, Hit>()
      for (const key of request.keys.filter(strongKey)) {
        await searchKey(reader, key, hits, deadline)
      }
      const snapshot = await transaction(
        pool,
        async (client) => (await captureInTransaction(client, config, request.batch_id)).snapshot,
      )
      const supplierPk = batchSupplierPk(snapshot)
      const ranked = [...hits.values()]
        .sort((a, b) => Number(b.exact) - Number(a.exact))
        .slice(0, MAX_MATCH_CANDIDATES)
      const candidates: MatchCandidateDto[] = []
      for (const hit of ranked) {
        const found = await candidate(reader, hit, request.keys, supplierPk, deadline)
        if (found) {
          candidates.push(found)
        }
      }
      const lots = await transaction(pool, (client) => competingLots(client, config, request))
      if (lots === 'incomplete') {
        throw new Unavailable()
      }
      for (const lot of lots) {
        if (candidates.length >= MAX_MATCH_CANDIDATES) {
          break
        }
        candidates.push({
          kind: 'lot',
          batch_id: lot.batchId,
          batch_title: lot.batchTitle,
          lot_id: lot.lotId,
          lot_label: lot.lotLabel,
          matched_by: lot.matched,
        })
      }
      // Whatever InvenTree sent must fit the contract before it is stored in a question.
      for (const found of candidates) {
        requireCandidate(found)
      }
      return { ...base, searched: 'remote', candidates, verdict: verdictOf(candidates, undefined) }
    } catch (error) {
      if (error instanceof Unavailable) {
        return { ...base, searched: 'unavailable', candidates: [], verdict: 'none' }
      }
      throw error
    }
  }
}

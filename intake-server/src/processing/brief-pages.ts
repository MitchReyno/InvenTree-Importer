import type { PoolClient } from 'pg'
import {
  BRIEF_MAX_PAGES,
  validate,
  type BriefEntryDto,
  type BriefPageDto,
  type SealedBriefDto,
  type SessionBriefDto,
} from '@invimport/contracts'
import { canonicalRecord, strictJson } from '@invimport/contracts/json'
import { fail, sealed, unseal } from './model.ts'

/** Each page's entries stay within this, so a page fits any tool reply with room to spare. */
export const BRIEF_PAGE_MAX_BYTES = 32 * 1024
/** The opening renders the brief within this, and summarises what is past it. */
export const BRIEF_OPENING_MAX_BYTES = 48 * 1024
/** A kept current view may be at most this, which bounds the store per view. */
export const BRIEF_VIEW_MAX_BYTES = 2 * 1024 * 1024
/** Current views kept per attempt; reading another drops the oldest. */
export const BRIEF_VIEWS_PER_ATTEMPT = 4

/** One page of a brief with its sealed bytes and digest. */
export interface SealedBriefPage {
  page: BriefPageDto
  bytes: Buffer
  digest: Buffer
}

function entryBytes(entry: BriefEntryDto) {
  return Buffer.byteLength(canonicalRecord(entry), 'utf8')
}

/**
 * Splits a brief's entries into pages of at most `BRIEF_PAGE_MAX_BYTES` each, in order. An entry
 * too large for a page, or a brief past `BRIEF_MAX_PAGES`, is over capacity.
 */
export function briefPages(brief: SessionBriefDto): SealedBriefPage[] {
  const groups: BriefEntryDto[][] = [[]]
  let used = 0
  for (const entry of brief.entries) {
    const size = entryBytes(entry)
    if (size > BRIEF_PAGE_MAX_BYTES) {
      fail('processing_input_capacity', 422)
    }
    if (used + size > BRIEF_PAGE_MAX_BYTES) {
      groups.push([])
      used = 0
    }
    groups[groups.length - 1].push(entry)
    used += size
  }
  if (groups.length > BRIEF_MAX_PAGES) {
    fail('processing_input_capacity', 422)
  }
  return groups.map((entries, offset) => {
    const page: BriefPageDto = {
      schema_version: 'bench-intake-brief-page/1',
      index: offset + 1,
      entries,
    }
    const { bytes, digest } = sealed(page)
    return { page, bytes, digest }
  })
}

/** The brief's digest: SHA-256 of its canonical bytes, which a page token is bound to. */
export function briefDigest(brief: SessionBriefDto) {
  return sealed(brief).digest.toString('hex')
}

/**
 * The brief as an input seals it, with its first `inline` pages' entries in the manifest; the
 * caller stores the rest in `processing_input_page`.
 */
export function sealBrief(
  brief: SessionBriefDto,
  pages: readonly SealedBriefPage[],
  inline: number,
): SealedBriefDto {
  return {
    schema_version: brief.schema_version,
    stage: brief.stage,
    lot_id: brief.lot_id,
    revision: brief.revision,
    sections: brief.sections,
    sha256: briefDigest(brief),
    pages: pages.map((page, offset) => ({
      index: page.page.index,
      sha256: page.digest.toString('hex'),
      entry_count: page.page.entries.length,
      ...(offset < inline ? { entries: page.page.entries } : {}),
    })),
  }
}

/** A sealed brief's page, from the manifest or the input's page store, checked against its digest. */
export async function sealedBriefPage(
  client: PoolClient,
  inputId: string,
  brief: SealedBriefDto,
  index: number,
): Promise<BriefEntryDto[]> {
  const sealedPage = brief.pages.find((page) => page.index === index)
  if (!sealedPage) {
    fail('brief_page_not_found', 404)
  }
  if (sealedPage.entries) {
    return sealedPage.entries
  }
  const rows = await client.query<{ page_bytes: Buffer; page_digest: Buffer }>(
    'SELECT page_bytes,page_digest FROM public.processing_input_page WHERE input_id=$1 AND page_index=$2',
    [inputId, index],
  )
  const row = rows.rows[0] ?? fail('processing_input_page_missing')
  if (row.page_digest.toString('hex') !== sealedPage.sha256) {
    fail('processing_input_page_corrupt')
  }
  const value = unseal(row.page_bytes, row.page_digest)
  validate('BriefPage', value)
  const page = value as BriefPageDto
  if (page.index !== index || page.entries.length !== sealedPage.entry_count) {
    fail('processing_input_page_corrupt')
  }
  return page.entries
}

/** Writes the pages a sealed brief keeps outside its manifest, with the input. */
export async function storeInputPages(
  client: PoolClient,
  inputId: string,
  pages: readonly SealedBriefPage[],
) {
  for (const page of pages) {
    await client.query(
      `INSERT INTO public.processing_input_page(input_id,page_index,page_bytes,page_digest)
       VALUES ($1,$2,$3,$4)`,
      [inputId, page.page.index, page.bytes, page.digest],
    )
  }
}

/**
 * Keeps a current view for the attempt, so its later pages come from the same brief after an
 * edit. The attempt keeps its `BRIEF_VIEWS_PER_ATTEMPT` most recently read views; the rest go. A view
 * past `BRIEF_VIEW_MAX_BYTES` is not kept, and the read is refused as unavailable.
 */
export async function keepCurrentView(
  client: PoolClient,
  attemptId: string,
  brief: SessionBriefDto,
): Promise<boolean> {
  const { bytes, digest } = sealed(brief)
  if (bytes.length > BRIEF_VIEW_MAX_BYTES) {
    return false
  }
  await client.query(
    `INSERT INTO public.processing_brief_view(attempt_id,brief_digest,brief_bytes)
     VALUES ($1,$2,$3)
     ON CONFLICT (attempt_id,brief_digest) DO UPDATE SET read_at=clock_timestamp()`,
    [attemptId, digest, bytes],
  )
  await client.query(
    `DELETE FROM public.processing_brief_view WHERE attempt_id=$1 AND brief_digest NOT IN (
       SELECT brief_digest FROM public.processing_brief_view WHERE attempt_id=$1
       ORDER BY read_at DESC, brief_digest LIMIT $2)`,
    [attemptId, BRIEF_VIEWS_PER_ATTEMPT],
  )
  return true
}

/** A kept current view by its digest, or null when it is no longer kept. */
export async function keptCurrentView(
  client: PoolClient,
  attemptId: string,
  digestHex: string,
): Promise<SessionBriefDto | null> {
  const rows = await client.query<{ brief_bytes: Buffer; brief_digest: Buffer }>(
    `SELECT brief_bytes,brief_digest FROM public.processing_brief_view
     WHERE attempt_id=$1 AND brief_digest=$2`,
    [attemptId, Buffer.from(digestHex, 'hex')],
  )
  const row = rows.rows[0]
  if (!row) {
    return null
  }
  const value = unseal(row.brief_bytes, row.brief_digest, BRIEF_VIEW_MAX_BYTES)
  validate('SessionBrief', value)
  return value as SessionBriefDto
}

/** What a page token names: an attempt's sealed or kept current view, and the page to read. */
export interface BriefPageCursor {
  attemptId: string
  view: 'sealed' | 'current'
  digest: string
  page: number
}

/** A token is the cursor's canonical JSON in base64url; the reader checks it names its own view. */
export function pageToken(cursor: BriefPageCursor) {
  return Buffer.from(canonicalRecord(cursor), 'utf8').toString('base64url')
}

/** The cursor a token names, or null for a token this server didn't issue in this shape. */
export function readPageToken(token: string): BriefPageCursor | null {
  let value: unknown
  try {
    value = strictJson(Buffer.from(token, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const cursor = value as Record<string, unknown>
  const shaped =
    Object.keys(cursor).length === 4 &&
    typeof cursor.attemptId === 'string' &&
    (cursor.view === 'sealed' || cursor.view === 'current') &&
    typeof cursor.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(cursor.digest) &&
    Number.isSafeInteger(cursor.page) &&
    (cursor.page as number) >= 1 &&
    (cursor.page as number) <= BRIEF_MAX_PAGES
  return shaped ? (cursor as unknown as BriefPageCursor) : null
}

/**
 * The opening's part of a sealed brief: the most leading entries from its manifest pages whose
 * rendered brief, with `rest` naming where the remainder is, fits `BRIEF_OPENING_MAX_BYTES`.
 */
export function openingBrief(
  brief: SealedBriefDto,
  rest: (page: number, shown: number, total: number) => unknown,
) {
  const inline: { entry: BriefEntryDto; page: number }[] = []
  let firstStoredPage: number | null = null
  for (const page of brief.pages) {
    if (!page.entries) {
      firstStoredPage = page.index
      break
    }
    for (const entry of page.entries) {
      inline.push({ entry, page: page.index })
    }
  }
  const total = brief.pages.reduce((sum, page) => sum + page.entry_count, 0)

  const render = (count: number) => {
    const restPage = count < inline.length ? inline[count].page : firstStoredPage
    return {
      revision: brief.revision,
      sha256: brief.sha256,
      sections: brief.sections,
      entries: inline.slice(0, count).map((item) => item.entry),
      rest: restPage === null ? null : rest(restPage, count, total),
    }
  }

  const fits = (count: number) =>
    Buffer.byteLength(JSON.stringify(render(count)), 'utf8') <= BRIEF_OPENING_MAX_BYTES

  // The rendered size grows with the count, so the largest count that fits is found by halving.
  let low = 0
  let high = inline.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(middle)) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return render(low)
}

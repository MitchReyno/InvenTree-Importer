import type { PoolClient } from 'pg'
import type {
  BriefVocabularyEntryDto,
  ProcessingInputV7Dto,
  SessionReadGuideArgsDto,
  SessionReadVocabularyArgsDto,
} from '@invimport/contracts'
import { VOCABULARY_PAGE_MAX_ENTRIES } from '@invimport/contracts'
import { canonicalRecord, strictJson } from '@invimport/contracts/json'
import { sha256 } from '#/db/authority.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { stageGuides } from '#/processing/stage-policy.ts'
import { catalogueVocabulary } from '#/processing/vocabulary.ts'
import { ToolRefusal } from './refusal.ts'

/** Vocabulary entries per page; a batch holds at most 100 read observations, so most fit one. */
export const VOCABULARY_PAGE_SIZE = VOCABULARY_PAGE_MAX_ENTRIES

interface GuideRow {
  section: string
  title: string
  text_bytes: Buffer
  text_digest: Buffer
}

function hex(value: string) {
  return sha256(Buffer.from(value, 'utf8')).toString('hex')
}

/** The digest a guide's ordered sections give, as `stageGuides` records it. */
function guideDigest(rows: readonly GuideRow[]) {
  const listed = rows.map((row) => ({
    section: row.section,
    title: row.title,
    text_sha256: row.text_digest.toString('hex'),
  }))
  return hex(canonicalRecord(listed))
}

/**
 * A `/7` stage's guide, in order. Each section must match its stored digest, and the whole guide
 * the digest its profile was sealed with, so no section can be added, dropped or reordered later.
 */
async function stageGuide(client: PoolClient, manifest: ProcessingInputV7Dto) {
  const rows = await client.query<GuideRow>(
    `SELECT section,title,text_bytes,text_digest FROM public.processing_stage_guide
     WHERE profile_id=$1 AND stage=$2 ORDER BY position`,
    [manifest.profile_id, manifest.stage],
  )
  // A `/7` input is never sealed for Inventory; its type is wider than its schema.
  const stage = manifest.stage === 'inventory' ? undefined : manifest.stage
  const sealed = stage && stageGuides[manifest.profile_id]?.[stage]
  const sectionsIntact = rows.rows.every((row) => sha256(row.text_bytes).equals(row.text_digest))
  if (!sealed || !sectionsIntact || guideDigest(rows.rows) !== sealed) {
    throw new Error('stage_guide_invalid')
  }
  return rows.rows
}

/**
 * `read_guide`: with no section, the stage's sections and their titles; with one, its text. A
 * section the stage's guide doesn't have is a correctable refusal naming those it does.
 */
export async function readGuide(
  client: PoolClient,
  manifest: ProcessingInputV7Dto,
  input: SessionReadGuideArgsDto,
) {
  const guide = await stageGuide(client, manifest)
  if (input.section === undefined) {
    return { sections: guide.map((row) => ({ section: row.section, title: row.title })) }
  }
  const row = guide.find((item) => item.section === input.section)
  if (!row) {
    const names = guide.map((item) => item.section).join(', ')
    throw new ToolRefusal(
      'validation_failed',
      `Your guide has no such section. Its sections are ${names}.`,
      [{ path: '/section', rule: 'enum', reason: `One of ${names}.` }],
    )
  }
  return {
    section: { section: row.section, title: row.title, text: row.text_bytes.toString('utf8') },
  }
}

/**
 * What a vocabulary page token continues: digests of the call's kind and search and of the list
 * it paged, and the offset. Digests keep the token short whatever the search.
 */
interface VocabularyCursor {
  filter: string
  list: string
  offset: number
}

function filterDigest(input: SessionReadVocabularyArgsDto) {
  return hex(canonicalRecord({ kind: input.kind ?? null, search: input.search ?? null }))
}

/** The list a page belongs to, by the observations it holds in order. */
function listDigest(entries: readonly BriefVocabularyEntryDto[]) {
  return hex(canonicalRecord(entries.map((entry) => entry.reference.observation_id)))
}

function vocabularyToken(cursor: VocabularyCursor) {
  return Buffer.from(canonicalRecord(cursor), 'utf8').toString('base64url')
}

function isDigest(field: unknown) {
  return typeof field === 'string' && /^[0-9a-f]{64}$/.test(field)
}

function decodeVocabularyToken(token: string): VocabularyCursor | null {
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
  const offsetShaped = Number.isSafeInteger(cursor.offset) && (cursor.offset as number) > 0
  const shaped =
    Object.keys(cursor).length === 3 &&
    isDigest(cursor.filter) &&
    isDigest(cursor.list) &&
    offsetShaped
  return shaped ? (cursor as unknown as VocabularyCursor) : null
}

/** The token a call continues, refused unless it came with the same kind and search. */
function continuedCursor(input: SessionReadVocabularyArgsDto) {
  if (input.page_token === undefined) {
    return null
  }
  const cursor = decodeVocabularyToken(input.page_token)
  if (!cursor || cursor.filter !== filterDigest(input)) {
    throw new ToolRefusal(
      'validation_failed',
      'That page token continues another lookup. Pass the same kind and search it came with.',
      [
        {
          path: '/page_token',
          rule: 'const',
          reason: 'Continue with the kind and search of the page it came from.',
        },
      ],
    )
  }
  return cursor
}

function matches(entry: BriefVocabularyEntryDto, input: SessionReadVocabularyArgsDto) {
  if (input.kind !== undefined && entry.reference.model !== input.kind) {
    return false
  }
  if (input.search === undefined) {
    return true
  }
  return entry.label.toLowerCase().includes(input.search.toLowerCase())
}

/**
 * `read_vocabulary`: the batch's catalogue records as they stand now, optionally of one kind and
 * whose labels contain a search regardless of case, `VOCABULARY_PAGE_SIZE` to a page. A token
 * continues only the list it came from: once the matching records change, it is refused as
 * stale and the session reads again from the first page.
 */
export async function readVocabulary(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  input: SessionReadVocabularyArgsDto,
) {
  const cursor = continuedCursor(input)
  const capture = await captureInTransaction(client, config, batchId)
  const found = catalogueVocabulary(capture.snapshot.observations, config.targetContextId).filter(
    (entry) => matches(entry, input),
  )
  const list = listDigest(found)
  if (cursor && cursor.list !== list) {
    throw new ToolRefusal(
      'stale',
      'The vocabulary changed since that page. Read it again without page_token.',
    )
  }
  const offset = cursor?.offset ?? 0
  const entries = found.slice(offset, offset + VOCABULARY_PAGE_SIZE)
  const next = offset + VOCABULARY_PAGE_SIZE
  const more = next < found.length
  return {
    vocabulary: {
      entries,
      total: found.length,
      ...(more
        ? { next_page_token: vocabularyToken({ filter: filterDigest(input), list, offset: next }) }
        : {}),
    },
  }
}

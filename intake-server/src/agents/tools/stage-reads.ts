import type { PoolClient } from 'pg'
import type {
  BriefVocabularyEntryDto,
  ProcessingInputV7Dto,
  SessionReadGuideArgsDto,
  SessionReadVocabularyArgsDto,
  VocabularyKindDto,
} from '@invimport/contracts'
import { VOCABULARY_KINDS } from '@invimport/contracts'
import { canonicalRecord, strictJson } from '@invimport/contracts/json'
import { sha256 } from '#/db/authority.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { catalogueVocabulary } from '#/processing/vocabulary.ts'
import { ToolRefusal } from './refusal.ts'

/** Vocabulary entries per page; a batch holds at most 100 read observations, so most fit one. */
export const VOCABULARY_PAGE_SIZE = 50

interface GuideRow {
  section: string
  title: string
  text_bytes: Buffer
  text_digest: Buffer
}

/** A `/7` stage's guide, in order, each section checked against its stored digest. */
async function stageGuide(client: PoolClient, manifest: ProcessingInputV7Dto) {
  const rows = await client.query<GuideRow>(
    `SELECT section,title,text_bytes,text_digest FROM public.processing_stage_guide
     WHERE profile_id=$1 AND stage=$2 ORDER BY position`,
    [manifest.profile_id, manifest.stage],
  )
  for (const row of rows.rows) {
    if (!sha256(row.text_bytes).equals(row.text_digest)) {
      throw new Error('stage_guide_invalid')
    }
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

/** What a vocabulary page token continues: the same kind and search, from an offset. */
interface VocabularyCursor {
  kind: VocabularyKindDto | null
  search: string | null
  offset: number
}

function vocabularyToken(cursor: VocabularyCursor) {
  return Buffer.from(canonicalRecord(cursor), 'utf8').toString('base64url')
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
  const kindShaped =
    cursor.kind === null || (VOCABULARY_KINDS as readonly unknown[]).includes(cursor.kind)
  const searchShaped = cursor.search === null || typeof cursor.search === 'string'
  const offsetShaped = Number.isSafeInteger(cursor.offset) && (cursor.offset as number) > 0
  const shaped = Object.keys(cursor).length === 3 && kindShaped && searchShaped && offsetShaped
  return shaped ? (cursor as unknown as VocabularyCursor) : null
}

/** The page a token continues, refused unless it names the same kind and search as the call. */
function startingOffset(input: SessionReadVocabularyArgsDto) {
  if (input.page_token === undefined) {
    return 0
  }
  const cursor = decodeVocabularyToken(input.page_token)
  const sameRequest =
    cursor !== null &&
    cursor.kind === (input.kind ?? null) &&
    cursor.search === (input.search ?? null)
  if (!sameRequest) {
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
  return cursor.offset
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
 * whose labels contain a search regardless of case, `VOCABULARY_PAGE_SIZE` to a page.
 */
export async function readVocabulary(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  input: SessionReadVocabularyArgsDto,
) {
  const offset = startingOffset(input)
  const capture = await captureInTransaction(client, config, batchId)
  const found = catalogueVocabulary(capture.snapshot.observations, config.targetContextId).filter(
    (entry) => matches(entry, input),
  )
  const entries = found.slice(offset, offset + VOCABULARY_PAGE_SIZE)
  const next = offset + VOCABULARY_PAGE_SIZE
  return {
    vocabulary: {
      entries,
      total: found.length,
      ...(next < found.length
        ? {
            next_page_token: vocabularyToken({
              kind: input.kind ?? null,
              search: input.search ?? null,
              offset: next,
            }),
          }
        : {}),
    },
  }
}

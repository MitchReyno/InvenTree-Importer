import {
  MAX_EXISTING_RECORDS,
  validate,
  type BatchRecordDto,
  type RecordExistingValuesDto,
  type RecordMappedDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import type { ReadOperation } from '#/inventory/transport.ts'
import { readBoundedBody } from '#/capture/bounded-body.ts'

const DETAIL_BODY_MAX_BYTES = 64 * 1024
const BODY_DEADLINE_MS = 5000
/** Reads run a few at a time, so one Records view cannot flood the target. */
const CONCURRENT_READS = 4
const TEXT_MAX = 512
/** Whole-request budget, inside the client's 20 s; records not reached by then are unavailable. */
const TOTAL_BUDGET_MS = 15000

const READ_KIND: Record<RecordMappedDto['model'], ReadOperation['kind']> = {
  part: 'get_part',
  company: 'get_company',
  category: 'get_category',
  parameter_template: 'get_parameter_template',
  location: 'get_location',
}

/** The extra fields each kind of record shows beside its name and description. */
const EXTRA_FIELDS: Partial<Record<RecordMappedDto['model'], [string, string][]>> = {
  parameter_template: [['units', 'units']],
  location: [['path', 'pathstring']],
}

export interface ExistingValuesTarget {
  targetContextId: string
  read: (operation: ReadOperation) => Promise<Response>
  now?: () => number
}

type Found = Extract<RecordExistingValuesDto['records'][number], { status: 'found' }>

/** Blank strings read as absent, as InvenTree stores an empty description. */
function text(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, TEXT_MAX) : null
}

/** Optional text a record may omit, leave null or leave blank; anything else is invalid. */
const optionalText = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string'

/** Settles with the response, or null once the budget is spent; a late response is cancelled. */
async function readWithin(read: Promise<Response>, budgetMs: number): Promise<Response | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs)
  })
  const settled = await Promise.race([read, expired])
  clearTimeout(timer)
  if (settled === null) {
    void read.then((late) => late.body?.cancel()).catch(() => undefined)
  }
  return settled
}

async function readOne(
  target: ExistingValuesTarget,
  key: string,
  mapped: RecordMappedDto,
  remainingMs: () => number,
): Promise<RecordExistingValuesDto['records'][number]> {
  const unavailable = { key, status: 'unavailable' as const }
  try {
    const response = await readWithin(
      target.read({ kind: READ_KIND[mapped.model], pk: mapped.pk }),
      remainingMs(),
    )
    if (response === null) {
      return unavailable
    }
    if (response.status === 404) {
      await response.body?.cancel()
      return { key, status: 'not_found' }
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      return unavailable
    }
    const bodyBudget = Math.min(BODY_DEADLINE_MS, remainingMs())
    if (bodyBudget <= 0) {
      await response.body.cancel()
      return unavailable
    }
    const bytes = await readBoundedBody(response.body, DETAIL_BODY_MAX_BYTES, bodyBudget)
    const row = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<
      string,
      unknown
    > | null
    // A body naming another record, or without this record's fields, is not its values.
    if (!row || typeof row !== 'object' || String(row.pk) !== mapped.pk) {
      return unavailable
    }
    const extras = EXTRA_FIELDS[mapped.model] ?? []
    if (
      typeof row.name !== 'string' ||
      row.name.trim() === '' ||
      !optionalText(row.description) ||
      extras.some(([, source]) => !optionalText(row[source]))
    ) {
      return unavailable
    }
    const fields: Found['fields'] = [
      { name: 'name', value: text(row.name) },
      { name: 'description', value: text(row.description) },
      ...extras.map(([name, source]) => ({ name, value: text(row[source]) })),
    ]
    return { key, status: 'found', fields }
  } catch {
    // Transport, body and decoding failures are unavailability, never an empty record.
    return unavailable
  }
}

/** Reads the current values of a batch's mapped records from the target, on request only. */
export function existingValuesReader(target: ExistingValuesTarget) {
  return async (records: readonly BatchRecordDto[]): Promise<RecordExistingValuesDto> => {
    const mapped = records.flatMap((record) =>
      record.mapped ? [{ key: record.key, mapped: record.mapped }] : [],
    )
    const chosen = mapped.slice(0, MAX_EXISTING_RECORDS)
    const results: RecordExistingValuesDto['records'] = new Array(chosen.length)
    let next = 0
    const now = target.now ?? (() => performance.now())
    const deadline = now() + TOTAL_BUDGET_MS

    async function worker() {
      while (next < chosen.length) {
        const index = next++
        const { key, mapped: record } = chosen[index]
        results[index] =
          now() >= deadline
            ? { key, status: 'unavailable' }
            : await readOne(target, key, record, () => deadline - now())
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENT_READS, chosen.length) }, worker))
    const result = {
      target_context_id: target.targetContextId,
      records: results,
      truncated: mapped.length > chosen.length,
    }
    validate('RecordExistingValues', result)
    return result
  }
}

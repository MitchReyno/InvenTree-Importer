import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type CaptureEditDto,
  type CaptureSnapshotDto,
  type CaptureObservationDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import type { DevConfig } from '../config.ts'
import { transaction } from '../db/database.ts'
import { appendEvent, idempotent, sha256 } from '../db/authority.ts'

export class CaptureError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code)
  }
}

export function fail(code: string, status = 422): never {
  throw new CaptureError(status, code)
}

export type CaptureBinding = Pick<DevConfig, 'actorId' | 'targetId' | 'targetContextId'>
type Binding = CaptureBinding
type Batch = {
  id: string
  source_id: string
  actor_id: string
  target_id: string
  target_context_id: string
  title: string
  revision: string
  archived: boolean
  stream_id: string
  updated_at: Date
}
type Subject = { id: string; label: string; revision: string; kind: 'lot' | 'part' }
type Selection =
  CaptureSnapshotDto['lots'][number]['location'] | CaptureSnapshotDto['lots'][number]['quantity']
const unset = { mode: 'unset' } as const
const inherit = { mode: 'inherit' } as const

/** Every lookup is actor AND fixed target/context scoped, including archived reads. */
async function batch(
  client: PoolClient,
  config: Binding,
  id: string,
  lock = false,
): Promise<Batch> {
  const result = await client.query<Batch>(
    `SELECT * FROM capture_batch WHERE id=$1 AND actor_id=$2 AND target_id=$3 AND target_context_id=$4 ${lock ? 'FOR UPDATE' : ''}`,
    [id, config.actorId, config.targetId, config.targetContextId],
  )
  return result.rows[0] ?? fail('not_found', 404)
}

const summary = (b: Batch) => ({
  id: b.id,
  source_id: b.source_id,
  title: b.title,
  revision: b.revision,
  archived: b.archived,
  updated_at: b.updated_at.toISOString(),
})

async function snapshot(
  client: PoolClient,
  config: Binding,
  id: string,
): Promise<CaptureSnapshotDto> {
  const b = await batch(client, config, id)
  const subjectsResult = await client.query<Subject>(
    'SELECT id,label,revision,kind FROM capture_subject WHERE batch_id=$1 ORDER BY id',
    [id],
  )
  const subjects = subjectsResult.rows
  const selectionsResult = await client.query<{
    subject_id: string | null
    field: string
    value: Selection
  }>(
    `SELECT DISTINCT ON (subject_id,field) subject_id,field,value
FROM capture_selection
WHERE batch_id=$1
ORDER BY subject_id,field,version DESC`,
    [id],
  )
  const selections = selectionsResult.rows

  const value = (subject: string | null, field: string, fallback: Selection) =>
    selections.find((s) => s.subject_id === subject && s.field === field)?.value ?? fallback

  const lotsResult = await client.query<{
    id: string
    contribution_key: string
    part_subject_id: string | null
  }>('SELECT id,contribution_key,part_subject_id FROM capture_lot WHERE batch_id=$1 ORDER BY id', [
    id,
  ])
  const lots = lotsResult.rows
  const notesResult = await client.query<{
    id: string
    subject_id: string | null
    text: string
    actor_id: string
    created_at: Date
  }>(
    `SELECT id,subject_id,text,actor_id,created_at
FROM capture_note
WHERE batch_id=$1
ORDER BY created_at,id`,
    [id],
  )
  const notes = notesResult.rows
  const observationsResult = await client.query(
    `SELECT id,model,pk,target_context_id,label,observed_at
FROM capture_observation
WHERE batch_id=$1
ORDER BY observed_at,id`,
    [id],
  )
  const observations = observationsResult.rows
  const cursor = (
    await client.query<{ head: string }>('SELECT head FROM ui_stream WHERE id=$1', [b.stream_id])
  ).rows[0].head
  const result = {
    ...summary(b),
    actor_id: b.actor_id,
    target_context_id: b.target_context_id,
    defaults: {
      quantity: value(null, 'quantity', unset),
      location: value(null, 'location', unset),
    },
    parts: subjects
      .filter((s) => s.kind === 'part')
      .map((s) => ({
        id: s.id,
        label: s.label,
        revision: s.revision,
        choice: value(s.id, 'choice', unset),
      })),
    lots: lots.map((l) => {
      const s = subjects.find((s) => s.id === l.id)!
      return {
        ...l,
        label: s.label,
        revision: s.revision,
        quantity: value(l.id, 'quantity', inherit),
        location: value(l.id, 'location', inherit),
      }
    }),
    notes: notes.map((n) => ({ ...n, created_at: n.created_at.toISOString(), producer: 'human' })),
    observations: observations.map((o) => ({ ...o, observed_at: o.observed_at.toISOString() })),
    cursor: { stream_id: b.stream_id, sequence: cursor },
  }
  validate('CaptureSnapshot', result)
  if (Buffer.byteLength(canonical(result)) > 245760) {
    fail('capture_capacity', 409)
  }
  // The complete runtime DTO check above is the narrowing boundary for SQL JSONB.
  return result as CaptureSnapshotDto
}

async function retainRevision(c: PoolClient, b: Batch, payload: unknown, publish = true) {
  const bytes = Buffer.from(canonical(payload))
  await c.query(
    `INSERT INTO capture_revision(batch_id,revision,actor_id,command_bytes,command_digest)
VALUES($1,$2,$3,$4,$5)`,
    [b.id, b.revision, b.actor_id, bytes, sha256(bytes)],
  )
  if (publish) {
    await appendEvent(c, b.stream_id, 'capture_changed', { batch_id: b.id, revision: b.revision })
  }
}

async function note(c: PoolClient, b: Batch, subject: string | null, text: string) {
  await c.query(
    'INSERT INTO capture_note(id,batch_id,subject_id,text,actor_id) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), b.id, subject, text, b.actor_id],
  )
}

/** Transaction-bound public capture seam. Callers acquire target/source locks first.
 * The original key is derived only from retained native lineage, never caller aliases.
 */
export async function captureInTransaction(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
  lock = false,
) {
  const retained = await batch(client, config, batchId, lock)
  const sourceResult = await client.query(
    'SELECT namespace_key,created_by FROM capture_source WHERE id=$1',
    [retained.source_id],
  )
  const source = sourceResult.rows[0]
  if (
    !source ||
    source.namespace_key !== `native_batch:${retained.source_id}` ||
    source.created_by !== retained.actor_id
  ) {
    fail('native_source_binding_invalid', 409)
  }
  return {
    snapshot: await snapshot(client, config, batchId),
    sourceId: retained.source_id,
    originalSourceKey: retained.source_id,
    streamId: retained.stream_id,
  }
}

async function applyLockedCaptureEdit(
  c: PoolClient,
  b: Batch,
  subjects: Subject[],
  input: CaptureEditDto,
) {
  const id = b.id
  const change = input.change
  if (b.archived && !(change.kind === 'batch' && change.archived === false)) {
    fail('batch_archived', 409)
  }
  const subject = (subjectId: string, kind?: Subject['kind']) =>
    subjects.find((s) => s.id === subjectId && (!kind || s.kind === kind)) ??
    fail('subject_not_found', 404)
  const checkPart = (partId: string | null) => {
    if (partId !== null) {
      subject(partId, 'part')
    }
  }
  const nextRevision = (BigInt(b.revision) + 1n).toString()
  const select = async (subjectId: string | null, field: string, value: Selection | undefined) => {
    if (value === undefined) {
      return
    } // Omission is not unset, unknown, clear or inherit.
    if (subjectId === null && value.mode === 'inherit') {
      fail('default_cannot_inherit')
    }
    let observation: string | null = null
    if (value.mode === 'set' && field !== 'quantity') {
      if (typeof value.value !== 'object' || value.value === null) {
        fail('invalid_reference')
      }
      const ref = value.value
      if (
        ref.model !== (field === 'choice' ? 'part' : 'location') ||
        ref.target_context_id !== b.target_context_id
      ) {
        fail('invalid_reference')
      }
      const found = await c.query(
        `SELECT 1
FROM capture_observation
WHERE batch_id=$1 AND id=$2 AND target_id=$3 AND target_context_id=$4 AND model=$5 AND pk=$6`,
        [id, ref.observation_id, b.target_id, ref.target_context_id, ref.model, ref.pk],
      )
      if (!found.rowCount) {
        fail('invalid_reference')
      }
      observation = ref.observation_id
    }
    await c.query(
      `INSERT INTO capture_selection(id,batch_id,subject_id,field,version,value,observation_id,actor_id)
VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), id, subjectId, field, nextRevision, value, observation, b.actor_id],
    )
  }
  switch (change.kind) {
    case 'batch':
      await c.query(
        'UPDATE capture_batch SET title=COALESCE($2,title),archived=COALESCE($3,archived) WHERE id=$1',
        [id, change.title, change.archived],
      )
      break
    case 'add_part':
    case 'add_lot': {
      if (subjects.length >= 100) {
        fail('capture_capacity', 409)
      }
      const sid = randomUUID()
      const kind = change.kind === 'add_part' ? 'part' : 'lot'
      await c.query('INSERT INTO capture_subject(batch_id,id,kind,label) VALUES($1,$2,$3,$4)', [
        id,
        sid,
        kind,
        change.label,
      ])
      if (change.kind === 'add_part') {
        await c.query('INSERT INTO capture_part(batch_id,id) VALUES($1,$2)', [id, sid])
      } else {
        checkPart(change.part_subject_id)
        await c.query(
          `INSERT INTO capture_lot(batch_id,id,source_id,contribution_key,part_subject_id)
VALUES($1,$2,$3,$4,$5)`,
          [id, sid, b.source_id, randomUUID(), change.part_subject_id],
        )
        await note(c, b, sid, change.note)
      }
      break
    }
    case 'lot':
      subject(change.id, 'lot')
      if (change.part_subject_id !== undefined) {
        checkPart(change.part_subject_id)
        await c.query('UPDATE capture_lot SET part_subject_id=$2 WHERE id=$1', [
          change.id,
          change.part_subject_id,
        ])
      }
      await select(change.id, 'quantity', change.quantity)
      await select(change.id, 'location', change.location)
      await c.query(
        'UPDATE capture_subject SET label=COALESCE($2,label),revision=revision+1 WHERE id=$1',
        [change.id, change.label],
      )
      break
    case 'part':
      subject(change.id, 'part')
      await select(change.id, 'choice', change.choice)
      await c.query(
        'UPDATE capture_subject SET label=COALESCE($2,label),revision=revision+1 WHERE id=$1',
        [change.id, change.label],
      )
      break
    case 'defaults':
      await select(null, 'quantity', change.quantity)
      await select(null, 'location', change.location)
      break
    case 'note':
      if (change.subject_id !== null) {
        subject(change.subject_id)
      }
      await note(c, b, change.subject_id, change.text)
      break
  }
  b.revision = nextRevision
  await c.query('UPDATE capture_batch SET revision=$2,updated_at=now() WHERE id=$1', [
    id,
    b.revision,
  ])
  await retainRevision(c, b, input, false)
}

export interface LockedCaptureEdit {
  /** Internal pre-publication facts. Use readPublished for a public response cursor. */
  snapshot: CaptureSnapshotDto
  streamId: string
  apply(input: CaptureEditDto): Promise<CaptureSnapshotDto>
  publish(): Promise<void>
  readPublished(): Promise<CaptureSnapshotDto>
}

/** Acquire all capture locks before a consumer locks processing jobs, attempts or questions. */
export async function lockCaptureForEdit(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
  expectedRevision: string,
): Promise<LockedCaptureEdit> {
  const retained = await batch(client, config, batchId, true)
  if (retained.revision !== expectedRevision) {
    fail('revision_conflict', 412)
  }
  const subjectsResult = await client.query<Subject>(
    'SELECT id,label,revision,kind FROM capture_subject WHERE batch_id=$1 ORDER BY id FOR UPDATE',
    [batchId],
  )
  const initialSnapshot = await snapshot(client, config, batchId)
  let phase: 'locked' | 'applied' | 'published' = 'locked'
  const publicationId = randomUUID()

  return {
    snapshot: initialSnapshot,
    streamId: retained.stream_id,

    async apply(input) {
      if (phase !== 'locked') {
        fail('capture_edit_already_applied')
      }
      validate('CaptureEdit', input)
      if (input.expected_revision !== expectedRevision) {
        fail('revision_conflict', 412)
      }
      await applyLockedCaptureEdit(client, retained, subjectsResult.rows, input)
      await client.query('INSERT INTO capture_edit_publication VALUES($1,$2)', [
        publicationId,
        batchId,
      ])
      phase = 'applied'
      return snapshot(client, config, batchId)
    },

    async publish() {
      if (phase !== 'applied') {
        fail('capture_edit_publication_order')
      }
      await appendEvent(client, retained.stream_id, 'capture_changed', {
        batch_id: batchId,
        revision: retained.revision,
      })
      await client.query('DELETE FROM capture_edit_publication WHERE id=$1', [publicationId])
      phase = 'published'
    },

    async readPublished() {
      if (phase !== 'published') {
        fail('capture_edit_publication_required')
      }
      return snapshot(client, config, batchId)
    },
  }
}

/** Capture has no dependency on execution SQL. Consumers use retained source/lot snapshots. */
export function captureRepository(pool: Pool, config: Binding) {
  const command = (
    action: string,
    resource: string,
    key: string,
    payload: unknown,
    work: (c: PoolClient) => Promise<unknown>,
  ) => {
    // A retained key must not bypass current target/context scope after operator reconfiguration.
    const resourceKey = `${config.targetId}:${config.targetContextId}:${resource}`
    return transaction(pool, (c) =>
      idempotent(c, { actorId: config.actorId, action, resourceKey, key }, payload, () => work(c)),
    )
  }

  return {
    async list() {
      const rows = (
        await pool.query<Batch>(
          `SELECT *
FROM capture_batch
WHERE actor_id=$1 AND target_id=$2 AND target_context_id=$3
ORDER BY updated_at DESC,id LIMIT 101`,
          [config.actorId, config.targetId, config.targetContextId],
        )
      ).rows
      return { batches: rows.slice(0, 100).map(summary), truncated: rows.length > 100 }
    },
    async read(id: string) {
      return transaction(pool, async (c) => {
        await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return snapshot(c, config, id)
      })
    },
    async create(key: string, input: { title: string; note: string }) {
      return command('capture_create', 'batches', key, input, async (c) => {
        const id = randomUUID()
        const source = randomUUID()
        const stream = randomUUID()
        await c.query('INSERT INTO capture_source(id,namespace_key,created_by) VALUES($1,$2,$3)', [
          source,
          `native_batch:${source}`,
          config.actorId,
        ])
        await c.query('INSERT INTO ui_stream(id,stream_key) VALUES($1,$2)', [
          stream,
          `capture:${id}`,
        ])
        await c.query(
          `INSERT INTO capture_batch(id,source_id,actor_id,target_id,target_context_id,stream_id,title)
VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            source,
            config.actorId,
            config.targetId,
            config.targetContextId,
            stream,
            input.title,
          ],
        )
        const b = await batch(c, config, id)
        await note(c, b, null, input.note)
        await retainRevision(c, b, input)
        return snapshot(c, config, id)
      })
    },
    async edit(id: string, key: string, input: CaptureEditDto) {
      return command('capture_edit', id, key, input, async (c) => {
        const locked = await lockCaptureForEdit(c, config, id, input.expected_revision)
        await locked.apply(input)
        await locked.publish()
        return locked.readPublished()

      })
    },
    async observe(id: string, key: string, observation: CaptureObservationDto) {
      // Network read already completed outside this transaction. Key binds requested model/PK.
      return command(
        'capture_observe',
        id,
        key,
        { model: observation.model, pk: observation.pk },
        async (c) => {
          const b = await batch(c, config, id, true)
          if (b.archived) {
            fail('batch_archived', 409)
          }
          const count = await c.query<{ count: string }>(
            'SELECT count(*) FROM capture_observation WHERE batch_id=$1',
            [id],
          )
          if (BigInt(count.rows[0].count) >= 100n) {
            fail('capture_capacity', 409)
          }
          await c.query(
            `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label,observed_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              observation.id,
              id,
              b.target_id,
              b.target_context_id,
              observation.model,
              observation.pk,
              observation.label,
              observation.observed_at,
            ],
          )
          await appendEvent(c, b.stream_id, 'capture_observation', {
            batch_id: id,
            observation_id: observation.id,
          })
          await snapshot(c, config, id) // Enforce the same retained-response budget before publication.
          return observation
        },
      )
    },
  }
}

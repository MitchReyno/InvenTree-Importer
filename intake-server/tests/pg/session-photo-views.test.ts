import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Pool, PoolClient } from 'pg'
import sharp from 'sharp'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { validate } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession, seedPhoto } from '../support/sessions.ts'
import { mediaEditor } from '../support/media-removal.ts'
import { grantMedia } from '#/media/grants.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { sealed } from '#/processing/model.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability, revokeSessionCapability } from '#/agents/tools/capability.ts'
import {
  SESSION_IMAGE_BUDGET_BYTES,
  sessionTools,
  type SessionToolContext,
  type SessionToolOutput,
} from '#/agents/tools/handlers.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const capabilityRun = (token: string) => digest(Buffer.from(token))

/** A lot session with one small photo pinned in its manifest, and its tools. */
async function photoSession(fixture: Fixture, root: string) {
  const capture = await fixture.seedCapture()
  const original = await sharp({
    create: { width: 64, height: 48, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer()
  const preview = await sharp(original).resize(32, 24).png().toBuffer()
  const store = await BlobStore.initialize(
    join(root, 'blobs'),
    await readMediaStoreIdentity(fixture.db.pool),
  )
  await transaction(fixture.db.pool, async (client) => {
    await store.publish(client, original)
    await store.publish(client, preview)
  })
  const photo = await seedPhoto(fixture, capture.batch.id, { width: 32, height: 24 }, 'Photo', 0, {
    original,
    preview,
  })
  await fixture.db.pool.query(
    'INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id) VALUES($1,$2,$3,$4,true,1,$5)',
    [randomUUID(), capture.batch.id, photo.evidence, capture.packetA.id, fixture.identity.actor],
  )
  const session = await lotSession(fixture, capture, capture.packetA)
  const token = await transaction(fixture.runner.pool, (client) =>
    issueSessionCapability(client, session.attempt),
  )
  const context: SessionToolContext = {
    pool: fixture.runner.pool,
    config: fixture.config,
    store,
    statusIntervalMs: 0,
    imageBudget: new Map(),
    deliveredMedia: new Map(),
    cropCacheDir: join(root, 'crops'),
  }
  const args = { evidence_id: photo.evidence, version_id: photo.version }
  const mediaSource = {
    kind: 'media_version',
    evidence_id: photo.evidence,
    version_id: photo.version,
    sha256: digest(original),
  }
  return { capture, store, photo, session, token, context, args, mediaSource }
}

async function withPhotoSession(
  run: (setup: Awaited<ReturnType<typeof photoSession>> & { fixture: Fixture }) => Promise<void>,
) {
  const fixture = await processingFixture()
  const root = await realpath(await mkdtemp(join(tmpdir(), 'photo-views-')))
  try {
    await run({ ...(await photoSession(fixture, root)), fixture })
  } finally {
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

async function photoViews(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ seq: string; payload: unknown; xmin: string }>(
    "SELECT seq, payload, xmin::text FROM agent_session_outbox WHERE session_id=$1 AND kind='photo_view' ORDER BY seq",
    [attemptId],
  )
  return rows.rows
}

async function sessionChangedEvents(fixture: Fixture, batchId: string) {
  const rows = await fixture.db.pool.query<{ xmin: string }>(
    `SELECT e.xmin::text FROM ui_event e JOIN capture_batch b ON b.stream_id=e.stream_id
     WHERE b.id=$1 AND e.kind='session_changed' ORDER BY e.sequence`,
    [batchId],
  )
  return rows.rows
}

/**
 * A pool whose COMMIT of a transaction that wrote a photo view loses its acknowledgement:
 * PostgreSQL commits, but the caller sees an error, as when the connection drops.
 */
function commitLosingPool(pool: Pool, outcome: 'committed' | 'rolled_back'): Pool {
  const connect = async () => {
    const client = await pool.connect()
    let wroteView = false
    const query = async (...args: unknown[]) => {
      const first = args[0] as string | { text?: string }
      const text = typeof first === 'string' ? first : (first?.text ?? '')
      if (/insert into "agent_session_outbox"/i.test(text)) {
        wroteView = true
      }
      if (text === 'COMMIT' && wroteView) {
        wroteView = false
        await client.query(outcome === 'committed' ? 'COMMIT' : 'ROLLBACK')
        throw new Error('connection_lost')
      }
      return (client.query as (...values: unknown[]) => Promise<unknown>)(...args)
    }
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return query
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PoolClient
  }
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') {
        return connect
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function delivered(output: SessionToolOutput) {
  validate('SessionToolResult', output.result)
  if (!output.result.ok || !output.result.delivered) {
    throw new Error(`expected a delivery: ${JSON.stringify(output.result)}`)
  }
  return output.result.delivered
}

test('a delivered fetch records one photo view, with session_changed in the same transaction', async () => {
  await withPhotoSession(async ({ fixture, capture, session, token, context, args }) => {
    const tools = sessionTools(context)
    const region = { x: 4, y: 2, width: 16, height: 12, source_width: 32, source_height: 24 }
    const before = await sessionChangedEvents(fixture, capture.batch.id)

    const output = await tools.fetch_evidence(token, { ...args, page: 1, region })
    const sent = delivered(output)
    assert.equal(output.images?.length, 1)
    const bytes = Buffer.from(output.images![0]!.base64, 'base64')
    // The fixture's region is 16 × 12 preview pixels, small enough to be sent at its own size.
    const decoded = await sharp(bytes).metadata()
    assert.deepEqual([decoded.width, decoded.height], [16, 12])

    // Then the run's budget is spent: the refused fetch is not a view.
    context.imageBudget.set(capabilityRun(token), SESSION_IMAGE_BUDGET_BYTES)
    const exhausted = await tools.fetch_evidence(token, args)
    assert.equal(exhausted.images, undefined)
    assert.ok(exhausted.result.ok && exhausted.result.delivered === undefined)

    const views = await photoViews(fixture, session.attempt)
    assert.equal(views.length, 1)
    assert.deepEqual(views[0]!.payload, {
      evidence_id: args.evidence_id,
      version_id: args.version_id,
      page: 1,
      region: { x: 4, y: 2, width: 16, height: 12 },
      delivered: {
        width: 16,
        height: 12,
        media_type: `image/${decoded.format}`,
        sha256: digest(bytes),
      },
    })
    assert.deepEqual(
      [sent.width, sent.height, sent.media_type, sent.sha256],
      [16, 12, `image/${decoded.format}`, digest(bytes)],
    )
    const events = await sessionChangedEvents(fixture, capture.batch.id)
    assert.equal(events.length, before.length + 1)
    assert.equal(events.at(-1)!.xmin, views[0]!.xmin, 'one transaction wrote both')

    // The history read decodes it.
    const timeline = await fixture.http(
      `/batches/${capture.batch.id}/processing/${session.job}/session`,
    )
    assert.equal(timeline.status, 200)
    validate('SessionTimeline', timeline.value)
    const outbox = (timeline.value as { outbox: { kind: string; payload: unknown }[] }).outbox
    assert.deepEqual(
      outbox.map((item) => item.kind),
      ['photo_view'],
    )
    assert.deepEqual(outbox[0]!.payload, views[0]!.payload)
  })
})

const races = {
  removal: async (fixture: Fixture, setup: Awaited<ReturnType<typeof photoSession>>) => {
    await grantMedia(fixture.db.pool, fixture.api.name, 'api')
    const media = mediaEditor(fixture.api.pool, fixture.config, setup.capture.batch.id)
    await media.applied({ kind: 'remove', evidence_ids: [setup.photo.evidence] })
  },
  revocation: async (fixture: Fixture, setup: Awaited<ReturnType<typeof photoSession>>) => {
    await transaction(fixture.runner.pool, (client) =>
      revokeSessionCapability(client, setup.session.attempt),
    )
  },
  // The worker revokes the token after these; the fetch must not wait for that.
  cancellation: async (fixture: Fixture, setup: Awaited<ReturnType<typeof photoSession>>) => {
    await fixture.db.pool.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
      setup.session.attempt,
    ])
  },
  supersession: async (fixture: Fixture, setup: Awaited<ReturnType<typeof photoSession>>) => {
    const next = { attempt: randomUUID(), command: randomUUID() }
    const command = sealed({ fixture: 'photo-view-successor', attempt_id: next.attempt })
    await transaction(fixture.db.pool, async (client) => {
      await client.query(
        `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
         VALUES($1,$2,$3,$4,'process','processing/5',$5,'bench-sessions',$6,$7)`,
        [
          next.command,
          fixture.identity.actor,
          fixture.identity.target,
          fixture.identity.context,
          `processing:${next.attempt}`,
          command.bytes,
          command.digest,
        ],
      )
      await client.query(
        `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
         SELECT $1,batch_id,job_id,2,input_id,profile_id,$2,channel_digest,'queued'
         FROM processing_attempt WHERE id=$3`,
        [next.attempt, next.command, setup.session.attempt],
      )
      await client.query('UPDATE processing_job SET current_attempt_id=$1 WHERE id=$2', [
        next.attempt,
        setup.session.job,
      ])
    })
  },
}

/**
 * A pool that runs `beforeConnect` before handing out each connection, and `afterQuery` after
 * each statement, so a test can act between the fetch's phases.
 */
function steppedPool(
  pool: Pool,
  hooks: {
    beforeConnect?: () => Promise<void>
    afterQuery?: (text: string, client: PoolClient) => Promise<void>
  },
): Pool {
  const connect = async () => {
    await hooks.beforeConnect?.()
    const client = await pool.connect()
    const query = async (...args: unknown[]) => {
      const first = args[0] as string | { text?: string }
      const text = typeof first === 'string' ? first : (first?.text ?? '')
      const result = await (client.query as (...values: unknown[]) => Promise<unknown>)(...args)
      await hooks.afterQuery?.(text, client)
      return result
    }
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return query
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PoolClient
  }
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') {
        return connect
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

for (const [name, race] of Object.entries(races)) {
  test(`a ${name} committed after encoding refuses the fetch, records nothing and releases the budget`, async () => {
    await withPhotoSession(async (setup) => {
      const { fixture, capture, session, token, context, args } = setup
      const run = capabilityRun(token)
      let raced = false
      // The final transaction is the first connection after the image is encoded and reserved.
      const pool = steppedPool(fixture.runner.pool, {
        beforeConnect: async () => {
          if (!raced && (context.imageBudget.get(run) ?? 0) > 0) {
            raced = true
            await race(fixture, setup)
          }
        },
      })
      const before = await sessionChangedEvents(fixture, capture.batch.id)

      const output = await sessionTools({ ...context, pool }).fetch_evidence(token, args)
      validate('SessionToolResult', output.result)
      assert.equal(raced, true, 'the race ran after encoding and reservation')
      assert.equal(output.result.ok, false)
      assert.equal(output.images, undefined)
      assert.equal(
        !output.result.ok && output.result.error,
        name === 'removal' ? 'media_evidence_removed' : 'capability_refused',
      )
      assert.equal((await photoViews(fixture, session.attempt)).length, 0)
      assert.equal((await sessionChangedEvents(fixture, capture.batch.id)).length, before.length)
      assert.equal(context.imageBudget.get(run) ?? 0, 0)
      assert.equal(context.deliveredMedia.get(session.job)?.has(args.version_id) ?? false, false)
    })
  })
}

/** Polls until `waiter` is blocked by `holder`, or fails after about five seconds. */
async function untilBlockedBy(fixture: Fixture, waiter: () => number | undefined, holder: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pid = waiter()
    if (pid !== undefined) {
      const blocking = await fixture.db.pool.query<{ blockers: number[] }>(
        'SELECT pg_blocking_pids($1) AS blockers',
        [pid],
      )
      if (blocking.rows[0].blockers.includes(holder)) {
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('never_blocked')
}

test('a revocation committed while the final transaction waits on the batch lock refuses the fetch', async () => {
  await withPhotoSession(async (setup) => {
    const { fixture, capture, session, token, context, args } = setup
    const run = capabilityRun(token)
    let fetchPid: number | undefined
    let capabilityLive: boolean | undefined
    let competitor: Promise<void> | undefined
    // The fetch's final transaction resolves the still-live capability, then waits on the
    // competitor's batch lock; the competitor revokes the capability and commits.
    const pool = steppedPool(fixture.runner.pool, {
      beforeConnect: async () => {
        if (competitor || (context.imageBudget.get(run) ?? 0) === 0) {
          return
        }
        const holder = await fixture.db.pool.connect()
        await holder.query('BEGIN')
        await holder.query('SELECT 1 FROM capture_batch WHERE id=$1 FOR UPDATE', [capture.batch.id])
        const holderPid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid
        competitor = (async () => {
          try {
            await untilBlockedBy(fixture, () => fetchPid, holderPid)
            const live = await holder.query<{ live: boolean }>(
              'SELECT capability_sha256 IS NOT NULL AS live FROM agent_session WHERE attempt_id=$1',
              [session.attempt],
            )
            capabilityLive = live.rows[0].live
            await revokeSessionCapability(holder, session.attempt)
            await holder.query('COMMIT')
          } catch (error) {
            await holder.query('ROLLBACK')
            throw error
          } finally {
            holder.release()
          }
        })()
      },
      afterQuery: async (text, client) => {
        if (competitor && fetchPid === undefined && text === 'BEGIN') {
          const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
          fetchPid = pid.rows[0].pid
        }
      },
    })
    const before = await sessionChangedEvents(fixture, capture.batch.id)

    const output = await sessionTools({ ...context, pool }).fetch_evidence(token, args)
    await competitor
    assert.equal(capabilityLive, true, 'the capability was live while the fetch waited')
    validate('SessionToolResult', output.result)
    assert.equal(!output.result.ok && output.result.error, 'capability_refused')
    assert.equal(output.images, undefined)
    assert.equal((await photoViews(fixture, session.attempt)).length, 0)
    assert.equal((await sessionChangedEvents(fixture, capture.batch.id)).length, before.length)
    assert.equal(context.imageBudget.get(run) ?? 0, 0)
    assert.equal(context.deliveredMedia.get(session.job)?.has(args.version_id) ?? false, false)
  })
})

test('a removal started while the final transaction holds its locks waits for the view', async () => {
  await withPhotoSession(async (setup) => {
    const { fixture, capture, session, token, context, args } = setup
    await grantMedia(fixture.db.pool, fixture.api.name, 'api')
    const media = mediaEditor(fixture.api.pool, fixture.config, capture.batch.id)
    let removal: Promise<unknown> | undefined
    let removalDoneWhileOpen: boolean | undefined
    let removalDone = false
    const pool = steppedPool(fixture.runner.pool, {
      afterQuery: async (text, client) => {
        if (removal || !/insert into "agent_session_outbox"/i.test(text)) {
          return
        }
        const fetchPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid
        removal = media
          .applied({ kind: 'remove', evidence_ids: [args.evidence_id] })
          .then((result) => {
            removalDone = true
            return result
          })
        // Hold the fetch's transaction open until the API's removal is blocked by it.
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await fixture.db.pool.query<{ pid: number }>(
            'SELECT pid FROM pg_stat_activity WHERE usename=$1 AND $2 = ANY(pg_blocking_pids(pid))',
            [fixture.api.name, fetchPid],
          )
          if (waiting.rows.length > 0) {
            removalDoneWhileOpen = removalDone
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error('removal_never_waited')
      },
    })

    const output = await sessionTools({ ...context, pool }).fetch_evidence(token, args)
    assert.equal(removalDoneWhileOpen, false, 'the removal was blocked by the open fetch')
    delivered(output)
    assert.equal(output.images?.length, 1)
    assert.equal((await photoViews(fixture, session.attempt)).length, 1)
    await removal
    assert.equal(removalDone, true)
  })
})

for (const outcome of ['committed', 'rolled_back'] as const) {
  test(`a lost COMMIT acknowledgement (${outcome}) keeps the reservation and returns no image`, async () => {
    await withPhotoSession(async ({ fixture, session, token, context, args }) => {
      const lost = { ...context, pool: commitLosingPool(fixture.runner.pool, outcome) }
      const output = await sessionTools(lost).fetch_evidence(token, args)
      validate('SessionToolResult', output.result)
      assert.deepEqual(
        [output.result.ok, !output.result.ok && output.result.error],
        [false, 'outcome_uncertain'],
      )
      assert.equal(output.images, undefined)
      assert.ok((lost.imageBudget.get(capabilityRun(token)) ?? 0) > 0, 'reservation kept')
      assert.equal(lost.deliveredMedia.size, 0, 'a withheld image is not delivered')
      // The handler can't tell the two apart; a view exists only if the commit went through.
      const views = await photoViews(fixture, session.attempt)
      assert.equal(views.length, outcome === 'committed' ? 1 : 0)
    })
  })
}

test('a failure before COMMIT is a known rollback that releases the reservation', async () => {
  await withPhotoSession(async ({ fixture, session, token, context, args }) => {
    // A stream that can't take the event fails inside the final transaction.
    const failing = {
      ...context,
      pool: new Proxy(fixture.runner.pool, {
        get(target, property) {
          if (property === 'connect') {
            return async () => {
              const client = await target.connect()
              return new Proxy(client, {
                get(inner, key) {
                  if (key === 'query') {
                    return async (...values: unknown[]) => {
                      const first = values[0] as string | { text?: string }
                      const text = typeof first === 'string' ? first : (first?.text ?? '')
                      if (/insert into "ui_event"/i.test(text)) {
                        throw new Error('event_insert_failed')
                      }
                      return (inner.query as (...args: unknown[]) => Promise<unknown>)(...values)
                    }
                  }
                  const value: unknown = Reflect.get(inner, key)
                  return typeof value === 'function' ? value.bind(inner) : value
                },
              })
            }
          }
          const value: unknown = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }),
    }
    await assert.rejects(sessionTools(failing).fetch_evidence(token, args), /event_insert_failed/)
    assert.equal(failing.imageBudget.get(capabilityRun(token)) ?? 0, 0)
    assert.equal((await photoViews(fixture, session.attempt)).length, 0)
    assert.equal(failing.deliveredMedia.size, 0)
  })
})

async function connect(url: string, token: string) {
  const client = new Client({ name: 'photo-views-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

test('through the MCP endpoint, an unknown commit returns the uncertain-outcome result and no image', async () => {
  await withPhotoSession(async ({ fixture, session, token, context, args }) => {
    const server = await startSessionToolServer({
      pool: commitLosingPool(fixture.runner.pool, 'committed'),
      config: fixture.config,
      store: context.store,
      cropCacheDir: context.cropCacheDir,
    })
    // A pending item, so the result must carry the count read before the lost COMMIT.
    await fixture.db.pool.query(
      "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,$4)",
      [randomUUID(), session.job, args, args.version_id],
    )
    const client = await connect(server.url, token)
    try {
      const result = await client.callTool({ name: 'fetch_evidence', arguments: args })
      const content = result.content as { type: string }[]
      assert.equal(result.isError, true)
      assert.deepEqual(
        content.map((item) => item.type),
        ['text'],
      )
      const structured = result.structuredContent as {
        error: string
        message: string
        pending_inbox: number
      }
      assert.equal(structured.error, 'outcome_uncertain')
      assert.equal(structured.pending_inbox, 1)
      assert.doesNotMatch(structured.message, /changed nothing/)
      assert.equal((await photoViews(fixture, session.attempt)).length, 1)
    } finally {
      await client.close()
      await server.close()
    }
  })
})

/** A lot session's note as a delivered source, and a proposal builder around it. */
function proposals(setup: Awaited<ReturnType<typeof photoSession>>) {
  const note = setup.session.manifest.notes.find(
    (item) => item.subject_id === setup.capture.packetA.id,
  )!
  const noteSource = {
    kind: 'note',
    note_id: note.id,
    text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
  }
  const v6 = (sources: unknown[], extra: Record<string, unknown> = {}) => ({
    proposal: {
      schema_version: 'bench-intake-proposal/6',
      subject_id: setup.capture.packetA.id,
      summary: 'A 0603 1k resistor reel, matched to its datasheet.',
      sources,
      relies_on: { fields: ['identity'], sources: [noteSource] },
      ...extra,
    },
  })
  return { noteSource, v6 }
}

async function storedCounts(fixture: Fixture, attemptId: string, batchId: string) {
  const rows = await fixture.db.pool.query<{ proposals: string; messages: string; outbox: string }>(
    `SELECT (SELECT count(*) FROM processing_proposal WHERE attempt_id=$1) AS proposals,
      (SELECT count(*) FROM processing_message WHERE attempt_id=$1) AS messages,
      (SELECT count(*) FROM agent_session_outbox WHERE session_id=$1) AS outbox`,
    [attemptId],
  )
  const events = await fixture.db.pool.query<{ count: string }>(
    `SELECT count(*) FROM ui_event e JOIN capture_batch b ON b.stream_id=e.stream_id WHERE b.id=$1`,
    [batchId],
  )
  return { ...rows.rows[0], events: events.rows[0].count }
}

const datasheet = 'https://www.yageo.com/upload/media/product/RC0603.pdf'

test('a web page source needs no delivery, but its URL must be absolute http(s) without credentials', async () => {
  await withPhotoSession(async (setup) => {
    const { fixture, capture, session, token, context } = setup
    const tools = sessionTools(context)
    const { noteSource, v6 } = proposals(setup)
    const webPage = { kind: 'web_page', url: datasheet, title: 'RC0603 datasheet' }

    const before = await storedCounts(fixture, session.attempt, capture.batch.id)
    const refusals: [string, unknown][] = [
      ['file URL', v6([{ kind: 'web_page', url: 'file:///etc/passwd' }])],
      ['credentials', v6([{ kind: 'web_page', url: 'https://user:secret@example.com/' }])],
      ['long URL', v6([{ kind: 'web_page', url: `${datasheet}?${'a'.repeat(2048)}` }])],
      ['no host', v6([{ kind: 'web_page', url: 'https://:443/datasheet.pdf' }])],
    ]
    for (const [label, args] of refusals) {
      const refused = await tools.propose(token, args)
      validate('SessionToolResult', refused.result)
      assert.equal(!refused.result.ok && refused.result.error, 'validation_failed', label)
      assert.ok(
        !refused.result.ok &&
          refused.result.issues?.some((issue) => issue.path === '/proposal/sources/0/url'),
        `${label}: ${JSON.stringify(refused.result)}`,
      )
    }
    const inReliance = await tools.propose(token, {
      proposal: {
        ...v6([webPage]).proposal,
        relies_on: { fields: ['identity'], sources: [webPage] },
      },
    })
    assert.equal(!inReliance.result.ok && inReliance.result.error, 'validation_failed')
    const catalogue = (source: unknown) => ({
      catalogue: {
        category: null,
        parameters: [],
        manufacturer: null,
        supplier: null,
        description: { text: 'Thick film resistor', sources: [source] },
      },
    })
    validate('SessionProposeArgs', v6([noteSource], catalogue(noteSource)))
    const inCatalogue = await tools.propose(token, v6([noteSource], catalogue(webPage)))
    assert.equal(!inCatalogue.result.ok && inCatalogue.result.error, 'validation_failed')
    // `/5` stays exact.
    const v5 = await tools.propose(token, {
      proposal: {
        ...v6([noteSource, webPage]).proposal,
        schema_version: 'bench-intake-proposal/5',
      },
    })
    assert.equal(!v5.result.ok && v5.result.error, 'validation_failed')
    assert.deepEqual(await storedCounts(fixture, session.attempt, capture.batch.id), before)

    // A web page doesn't excuse the other sources: the pinned photo was never fetched.
    const mixed = await tools.propose(token, v6([webPage, setup.mediaSource]))
    validate('SessionToolResult', mixed.result)
    assert.equal(!mixed.result.ok && mixed.result.error, 'source_not_delivered')
    assert.deepEqual(await storedCounts(fixture, session.attempt, capture.batch.id), before)

    // Nothing was fetched or delivered, and a web page alone is still accepted.
    const accepted = await tools.propose(token, v6([webPage]))
    assert.ok(accepted.result.ok, JSON.stringify(accepted.result))
  })
})

test('a /6 proposal with a web page goes through the advertised tool and reads beside a /5 one', async () => {
  await withPhotoSession(async (setup) => {
    const { fixture, capture, session, token, context } = setup
    const { noteSource, v6 } = proposals(setup)
    const server = await startSessionToolServer({
      pool: fixture.runner.pool,
      config: fixture.config,
      store: context.store,
      cropCacheDir: context.cropCacheDir,
      statusIntervalMs: 0,
    })
    const client = await connect(server.url, token)
    try {
      const listed = await client.listTools()
      const propose = listed.tools.find((tool) => tool.name === 'propose')!
      assert.match(propose.description ?? '', /WebFetch/)
      assert.match(JSON.stringify(propose.inputSchema), /bench-intake-proposal\/6/)
      const v5 = await client.callTool({
        name: 'propose',
        arguments: {
          proposal: {
            ...v6([noteSource]).proposal,
            schema_version: 'bench-intake-proposal/5',
          },
        },
      })
      assert.equal((v5.structuredContent as { ok: boolean }).ok, true)
      const page = {
        kind: 'web_page',
        url: datasheet,
        title: 'RC0603 datasheet',
        read_at: '2026-11-23T04:05:06.007Z',
      }
      const published = await client.callTool({
        name: 'propose',
        arguments: v6([noteSource, page]),
      })
      assert.equal((published.structuredContent as { ok: boolean }).ok, true)
    } finally {
      await client.close()
      await server.close()
    }

    const snapshot = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(snapshot.status, 200)
    validate('ProcessingSnapshot', snapshot.value)
    const job = (
      snapshot.value as {
        jobs: {
          id: string
          proposals: {
            value: { schema_version: string; sources: { kind: string; url?: string }[] }
          }[]
        }[]
      }
    ).jobs.find((item) => item.id === session.job)!
    const versions = job.proposals.map((item) => item.value.schema_version).sort()
    assert.deepEqual(versions, ['bench-intake-proposal/5', 'bench-intake-proposal/6'])
    const v6Read = job.proposals.find(
      (item) => item.value.schema_version === 'bench-intake-proposal/6',
    )!
    assert.deepEqual(
      v6Read.value.sources.map((source) => source.kind),
      ['note', 'web_page'],
    )
    assert.equal(v6Read.value.sources[1]!.url, datasheet)
  })
})

test('a /6 proposal within its field limits but over the sealed envelope limit is refused', async () => {
  await withPhotoSession(async (setup) => {
    const { fixture, capture, session, token, context } = setup
    const { noteSource, v6 } = proposals(setup)
    // Seventy long URLs fit every field limit but neither the 32,768-byte stored envelope nor
    // the batch's result budget; the envelope refusal comes first, as a correctable error.
    const pages = Array.from({ length: 70 }, (_, index) => ({
      kind: 'web_page',
      url: `https://example.com/${index}/${'a'.repeat(2000)}`,
    }))
    const args = v6([noteSource, ...pages])
    validate('SessionProposeArgs', args)
    const before = await storedCounts(fixture, session.attempt, capture.batch.id)

    const refused = await sessionTools(context).propose(token, args)
    validate('SessionToolResult', refused.result)
    assert.equal(!refused.result.ok && refused.result.error, 'validation_failed')
    assert.match(!refused.result.ok ? refused.result.message : '', /32768-byte limit/)
    assert.deepEqual(await storedCounts(fixture, session.attempt, capture.batch.id), before)
  })
})

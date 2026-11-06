import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { leadSession, seedPhoto } from '../support/sessions.ts'
import { transaction } from '../../src/db/database.ts'
import { mediaSnapshot } from '../../src/media/read.ts'
import {
  proposeLot,
  recordObservation,
  regroup,
  type LeadWriter,
} from '../../src/capture/evidence-observations.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const region = (x: number, width = 100) => ({
  kind: 'pixels' as const,
  x,
  y: 10,
  width,
  height: 100,
  source_width: 768,
  source_height: 512,
})
const readings = (marking: string) => ({ markings: [marking] })

async function withLead(
  run: (context: {
    fixture: Fixture
    batchId: string
    writer: LeadWriter
    photo: Awaited<ReturnType<typeof seedPhoto>>
    write: <T>(work: (client: import('pg').PoolClient) => Promise<T>) => Promise<T>
    read: () => Promise<CaptureSnapshotDto>
    edit: (change: Record<string, unknown>) => Promise<{ status: number; value: unknown }>
  }) => Promise<void>,
) {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const lead = await leadSession(fixture, capture)
    const photo = await seedPhoto(fixture, batchId, { width: 768, height: 512 })
    const writer: LeadWriter = { config: fixture.config, batchId, sessionId: lead.attempt }
    const read = async () => (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
    await run({
      fixture,
      batchId,
      writer,
      photo,
      write: (work) => transaction(fixture.writer.pool, work),
      read,
      edit: async (change) => {
        const current = await read()
        return fixture.http(`/batches/${batchId}/edits`, {
          expected_revision: current.revision,
          change,
        })
      },
    })
  } finally {
    await fixture.dispose()
  }
}

test('one photo holds three observations, and a region outside the image is refused', async () => {
  await withLead(async ({ fixture, batchId, writer, photo, write, read }) => {
    const before = await read()
    await assert.rejects(
      write((client) =>
        recordObservation(client, writer, {
          base_revision: before.revision,
          evidence_version_id: photo.version,
          region: region(700),
          readings: readings('1N4148'),
        }),
      ),
      /region_outside_source/,
    )
    const ids: string[] = []
    let revision = before.revision
    for (const [x, marking] of [
      [0, '1N4148'],
      [200, '16.000 MHz'],
      [400, 'LED 5mm'],
    ] as const) {
      const result = await write((client) =>
        recordObservation(client, writer, {
          base_revision: revision,
          evidence_version_id: photo.version,
          region: region(x),
          readings: readings(marking),
        }),
      )
      assert.equal(result.ok, true)
      assert.ok(result.ok && BigInt(result.revision) > BigInt(revision))
      revision = result.revision
      ids.push(result.ok ? result.id : '')
    }
    const after = await read()
    assert.equal(after.evidence_observations?.length, 3)
    assert.deepEqual(
      after.evidence_observations?.map((row) => row.readings.markings[0]),
      ['1N4148', '16.000 MHz', 'LED 5mm'],
    )
    // Agent writes keep the batch's operator as actor and record the session.
    const revisions = await fixture.db.pool.query<{ actor_id: string; agent_session_id: string }>(
      'SELECT actor_id,agent_session_id FROM capture_revision WHERE batch_id=$1 AND revision>$2',
      [batchId, before.revision],
    )
    assert.equal(revisions.rowCount, 3)
    for (const row of revisions.rows) {
      assert.equal(row.actor_id, fixture.identity.actor)
      assert.equal(row.agent_session_id, writer.sessionId)
    }
  })
})

test('lots group observations and their evidence links are derived from them', async () => {
  await withLead(async ({ fixture, batchId, writer, photo, write, read }) => {
    const back = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Back')
    const start = await read()
    const front = await write((client) =>
      recordObservation(client, writer, {
        base_revision: start.revision,
        evidence_version_id: photo.version,
        region: region(0),
        readings: readings('RC0603 10k'),
      }),
    )
    const rear = await write((client) =>
      recordObservation(client, writer, {
        base_revision: front.revision,
        evidence_version_id: back.version,
        region: region(0),
        readings: readings('Lot 2231'),
      }),
    )
    assert.ok(front.ok && rear.ok)
    const lot = await write((client) =>
      proposeLot(client, writer, {
        base_revision: rear.revision,
        label: '10k resistors',
        observation_ids: [front.id, rear.id],
        part: { label: 'RC0603FR-0710KL' },
        estimated_quantity: '500',
        quantity_basis: 'label · same packet in two photos',
      }),
    )
    assert.ok(lot.ok)
    const snapshot = await read()
    const formed = snapshot.lots.find((row) => row.id === lot.id)!
    assert.equal(formed.origin, 'agent')
    assert.equal(formed.agent_session_id, writer.sessionId)
    assert.equal(formed.estimated_quantity, '500')
    assert.deepEqual(formed.quantity, { mode: 'inherit' })
    assert.deepEqual([...formed.evidence_observation_ids!].sort(), [front.id, rear.id].sort())
    assert.ok(formed.part_subject_id)
    // Operator lots keep their legacy shape.
    assert.equal(snapshot.lots.find((row) => row.label === 'Packet A')!.origin, undefined)
    const media = await transaction(fixture.api.pool, (client) =>
      mediaSnapshot(client, fixture.config, batchId),
    )
    for (const evidenceId of [photo.evidence, back.evidence]) {
      assert.deepEqual(media.evidence.find((row) => row.id === evidenceId)!.linked_subject_ids, [
        lot.id,
      ])
    }
  })
})

test('an unrelated edit does not block forming, but a changed observation is stale', async () => {
  await withLead(async ({ writer, photo, write, read, edit }) => {
    const start = await read()
    const first = await write((client) =>
      recordObservation(client, writer, {
        base_revision: start.revision,
        evidence_version_id: photo.version,
        region: region(0),
        readings: readings('BC547'),
      }),
    )
    assert.ok(first.ok)
    const renamed = await edit({ kind: 'batch', title: 'Renamed by the operator' })
    assert.equal(renamed.status, 200)
    const formed = await write((client) =>
      proposeLot(client, writer, {
        base_revision: first.revision,
        label: 'BC547 transistors',
        observation_ids: [first.id],
      }),
    )
    assert.ok(formed.ok)
    assert.ok(BigInt(formed.revision) > BigInt((renamed.value as { revision: string }).revision))

    const second = await write((client) =>
      recordObservation(client, writer, {
        base_revision: formed.revision,
        evidence_version_id: photo.version,
        region: region(300),
        readings: readings('BC557'),
      }),
    )
    assert.ok(second.ok)
    const adjusted = await edit({
      kind: 'observation',
      observation_id: second.id,
      evidence_version_id: photo.version,
      region: region(310, 90),
    })
    assert.equal(adjusted.status, 200, JSON.stringify(adjusted.value))
    const lotsBefore = (await read()).lots.length
    const stale = await write((client) =>
      proposeLot(client, writer, {
        base_revision: second.revision,
        label: 'BC557 transistors',
        observation_ids: [second.id],
      }),
    )
    assert.equal(stale.ok, false)
    assert.ok(
      !stale.ok && stale.conflicts.some((c) => c.id === second.id && c.reason === 'changed'),
    )
    assert.equal((await read()).lots.length, lotsBefore)
  })
})

test('edited lots and observations only receive suggestions, which the operator resolves', async () => {
  await withLead(async ({ writer, photo, write, read, edit }) => {
    const start = await read()
    const tape = await write((client) =>
      recordObservation(client, writer, {
        base_revision: start.revision,
        evidence_version_id: photo.version,
        region: region(0),
        readings: readings('LED 0603 red'),
      }),
    )
    assert.ok(tape.ok)
    const lot = await write((client) =>
      proposeLot(client, writer, {
        base_revision: tape.revision,
        label: 'Red LEDs',
        observation_ids: [tape.id],
      }),
    )
    assert.ok(lot.ok)
    assert.equal((await edit({ kind: 'lot', id: lot.id, label: 'Red LEDs (checked)' })).status, 200)
    const editedLot = (await read()).lots.find((row) => row.id === lot.id)!
    assert.equal(editedLot.operator_edited, true)

    const current = await read()
    const back = await write((client) =>
      recordObservation(client, writer, {
        base_revision: current.revision,
        evidence_version_id: photo.version,
        region: region(300),
        readings: readings('Reel back'),
      }),
    )
    assert.ok(back.ok)
    const suggestion = await write((client) =>
      proposeLot(client, writer, {
        base_revision: back.revision,
        lot_id: lot.id,
        observation_ids: [back.id],
      }),
    )
    assert.ok(suggestion.ok && suggestion.suggested)
    let snapshot = await read()
    const unchanged = snapshot.lots.find((row) => row.id === lot.id)!
    assert.deepEqual(unchanged.evidence_observation_ids, [tape.id])
    assert.equal(unchanged.observation_set_version, editedLot.observation_set_version)
    assert.deepEqual(
      snapshot.evidence_observations!.find((row) => row.id === back.id)!.suggested_lot_ids,
      [lot.id],
    )
    const accepted = await edit({
      kind: 'observation_suggestion',
      observation_id: back.id,
      lot_id: lot.id,
      decision: 'accept',
    })
    assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
    snapshot = await read()
    assert.deepEqual(
      [...snapshot.lots.find((row) => row.id === lot.id)!.evidence_observation_ids!].sort(),
      [tape.id, back.id].sort(),
    )
    assert.equal(
      snapshot.evidence_observations!.find((row) => row.id === back.id)!.operator_edited,
      true,
    )

    // Revising an edited observation records a suggested superseding row instead.
    const revised = await write((client) =>
      recordObservation(client, writer, {
        base_revision: snapshot.revision,
        observation_id: back.id,
        evidence_version_id: photo.version,
        region: region(320),
        readings: readings('Reel back, lot 7'),
      }),
    )
    assert.ok(revised.ok && revised.suggested && revised.id !== back.id)
    snapshot = await read()
    const kept = snapshot.evidence_observations!.find((row) => row.id === back.id)!
    assert.deepEqual(kept.readings, readings('Reel back'))
    assert.equal(
      snapshot.evidence_observations!.find((row) => row.id === revised.id)!
        .supersedes_observation_id,
      back.id,
    )
  })
})

test('an AI observation is revised in place, and regroup moves it between AI lots', async () => {
  await withLead(async ({ writer, photo, write, read }) => {
    const start = await read()
    const a = await write((client) =>
      recordObservation(client, writer, {
        base_revision: start.revision,
        evidence_version_id: photo.version,
        region: region(0),
        readings: readings('2N3904'),
      }),
    )
    assert.ok(a.ok)
    const revised = await write((client) =>
      recordObservation(client, writer, {
        base_revision: a.revision,
        observation_id: a.id,
        evidence_version_id: photo.version,
        region: region(5),
        readings: readings('2N3904 (date 2231)'),
        visible_count: 12,
      }),
    )
    assert.ok(revised.ok && revised.id === a.id && !revised.suggested)
    const first = await write((client) =>
      proposeLot(client, writer, {
        base_revision: revised.revision,
        label: 'One',
        observation_ids: [a.id],
      }),
    )
    const b = await write((client) =>
      recordObservation(client, writer, {
        base_revision: first.revision,
        evidence_version_id: photo.version,
        region: region(300),
        readings: readings('2N3906'),
      }),
    )
    assert.ok(first.ok && b.ok)
    const second = await write((client) =>
      proposeLot(client, writer, {
        base_revision: b.revision,
        label: 'Two',
        observation_ids: [b.id],
      }),
    )
    assert.ok(second.ok)
    const moved = await write((client) =>
      regroup(client, writer, {
        base_revision: second.revision,
        moves: [{ observation_id: a.id, to_lot_id: second.id }],
      }),
    )
    assert.ok(moved.ok && !moved.suggested)
    const snapshot = await read()
    assert.equal(
      snapshot.lots.find((row) => row.id === first.id)!.evidence_observation_ids,
      undefined,
    )
    assert.deepEqual(
      [...snapshot.lots.find((row) => row.id === second.id)!.evidence_observation_ids!].sort(),
      [a.id, b.id].sort(),
    )
  })
})

test('the agent writer cannot set human-only values or touch edited rows, and the runner cannot write capture', async () => {
  await withLead(async ({ fixture, batchId, writer, photo, write, read, edit }) => {
    const start = await read()
    const tape = await write((client) =>
      recordObservation(client, writer, {
        base_revision: start.revision,
        evidence_version_id: photo.version,
        region: region(0),
        readings: readings('Crystal'),
      }),
    )
    assert.ok(tape.ok)
    const lot = await write((client) =>
      proposeLot(client, writer, {
        base_revision: tape.revision,
        label: 'Crystals',
        observation_ids: [tape.id],
      }),
    )
    assert.ok(lot.ok)
    const refused = async (pool: import('pg').Pool, sql: string, params: unknown[]) => {
      await assert.rejects(pool.query(sql, params), (error: { code?: string }) =>
        ['42501', '23000'].includes(error.code ?? ''),
      )
    }
    // Counted quantities and approval stay human: no selection insert.
    await refused(
      fixture.writer.pool,
      `INSERT INTO capture_selection(id,batch_id,subject_id,field,version,value,actor_id)
       VALUES(gen_random_uuid(),$1,$2,'quantity',99,'{"mode":"set","value":"50"}',$3)`,
      [batchId, lot.id, fixture.identity.actor],
    )
    await refused(fixture.writer.pool, 'UPDATE capture_lot SET operator_edited=true WHERE id=$1', [
      lot.id,
    ])
    await refused(
      fixture.writer.pool,
      'UPDATE processing_proposal SET value_digest=value_digest WHERE false',
      [],
    )
    assert.equal((await edit({ kind: 'lot', id: lot.id, label: 'Crystals (checked)' })).status, 200)
    await refused(fixture.writer.pool, "UPDATE capture_lot SET quantity_basis='x' WHERE id=$1", [
      lot.id,
    ])
    await refused(
      fixture.runner.pool,
      `INSERT INTO capture_evidence_observation(id,batch_id,evidence_version_id,region,readings,origin,revision)
       VALUES(gen_random_uuid(),$1,$2,'{"kind":"lines","from_line":1,"to_line":1}','{"markings":[]}','operator',1)`,
      [batchId, photo.version],
    )
    // Readers that serve media links can see the new tables.
    for (const pool of [fixture.runner.pool, fixture.api.pool]) {
      await pool.query('SELECT count(*) FROM capture_lot_evidence_observation')
    }
  })
})

test('lot-forming tools are for the lead session only, and their writes reach its timeline', async () => {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const { startSessionToolServer } = await import('../../src/agents/tools/server.ts')
  const { issueSessionCapability } = await import('../../src/agents/tools/capability.ts')
  const { lotSession } = await import('../support/sessions.ts')
  const fixture = await processingFixture()
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    statusIntervalMs: 60_000,
  })
  const connect = async (token: string) => {
    const client = new Client({ name: 'lead-tools-test', version: '1' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    return client
  }
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture)
    const lot = await lotSession(fixture, capture, capture.packetA)
    const photo = await seedPhoto(fixture, capture.batch.id, { width: 768, height: 512 })
    const undelivered = await seedPhoto(
      fixture,
      capture.batch.id,
      { width: 768, height: 512 },
      'Not sent',
    )
    // The photo reaches the lead as new evidence; the second one never does.
    await fixture.db.pool.query(
      `INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key)
       VALUES(gen_random_uuid(),$1,1,'evidence',$2,$3)`,
      [lead.job, { evidence_id: photo.evidence, version_id: photo.version }, photo.version],
    )
    const issue = (attemptId: string) =>
      transaction(fixture.runner.pool, (client) => issueSessionCapability(client, attemptId))
    const args = {
      base_revision: capture.batch.revision,
      evidence_version_id: photo.version,
      region: region(0),
      readings: readings('1N4007'),
    }
    const lotToken = await issue(lot.attempt)
    const lotClient = await connect(lotToken)
    try {
      const names = (await lotClient.listTools()).tools.map((tool) => tool.name)
      assert.ok(!names.includes('record_observation') && !names.includes('propose_lot'))
    } finally {
      await lotClient.close()
    }
    // The handler refuses on its own as well, whatever a client sends.
    const { sessionTools } = await import('../../src/agents/tools/handlers.ts')
    const handlers = sessionTools({
      pool: fixture.runner.pool,
      writerPool: fixture.writer.pool,
      config: fixture.config,
      statusIntervalMs: 60_000,
      imageBudget: new Map(),
      deliveredMedia: new Map(),
    })
    const refused = (await handlers.record_observation(lotToken, args)).result
    assert.deepEqual([refused.ok, !refused.ok && refused.error], [false, 'tool_not_allowed'])
    const leadClient = await connect(await issue(lead.attempt))
    try {
      const recorded = (await leadClient.callTool({ name: 'record_observation', arguments: args }))
        .structuredContent as { ok: boolean; id: string; revision: string }
      assert.equal(recorded.ok, true)
      assert.ok(BigInt(recorded.revision) > BigInt(capture.batch.revision))
      const outside = (
        await leadClient.callTool({
          name: 'record_observation',
          arguments: { ...args, base_revision: recorded.revision, region: region(700) },
        })
      ).structuredContent as { ok: boolean; error?: string }
      assert.deepEqual([outside.ok, outside.error], [false, 'validation_failed'])
      const notSent = (
        await leadClient.callTool({
          name: 'record_observation',
          arguments: {
            ...args,
            base_revision: recorded.revision,
            evidence_version_id: undelivered.version,
          },
        })
      ).structuredContent as { ok: boolean; error?: string }
      assert.deepEqual([notSent.ok, notSent.error], [false, 'source_not_delivered'])
      const outbox = await fixture.db.pool.query<{
        kind: string
        payload: { evidence_observation_id: string }
      }>('SELECT kind,payload FROM agent_session_outbox WHERE session_id=$1', [lead.attempt])
      assert.deepEqual(
        outbox.rows.map((row) => [row.kind, row.payload.evidence_observation_id]),
        [['observation', recorded.id]],
      )
    } finally {
      await leadClient.close()
    }
  } finally {
    await server.close()
    await fixture.dispose()
  }
})

test('an operator split and merge carry observations, and the lead session then only suggests', async () => {
  await withLead(async ({ fixture, batchId, writer, photo, write, read }) => {
    const start = await read()
    const one = await write((client) =>
      recordObservation(client, writer, {
        base_revision: start.revision,
        evidence_version_id: photo.version,
        region: region(0),
        readings: readings('22pF'),
      }),
    )
    assert.ok(one.ok)
    const two = await write((client) =>
      recordObservation(client, writer, {
        base_revision: one.revision,
        evidence_version_id: photo.version,
        region: region(300),
        readings: readings('100nF'),
      }),
    )
    assert.ok(two.ok)
    const lot = await write((client) =>
      proposeLot(client, writer, {
        base_revision: two.revision,
        label: 'Capacitors',
        observation_ids: [one.id, two.id],
      }),
    )
    assert.ok(lot.ok)
    // The processing fixture serves no operator-review routes, so call the repository itself.
    const { operatorRepository } = await import('../../src/operator-review/repository.ts')
    const { grantManual } = await import('../../src/review/grants.ts')
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const restructure = async (change: Record<string, unknown>) => {
      try {
        const value = await operatorRepository(fixture.api.pool, fixture.config).restructure(
          batchId,
          randomUUID(),
          { expected_revision: (await read()).revision, preview: false, change } as never,
        )
        return { status: 200, value }
      } catch (error) {
        return { status: 500, value: String(error) }
      }
    }
    const split = await restructure({
      kind: 'split_lot',
      lot_id: lot.id,
      children: [
        { label: '22pF', quantity: '10', observation_ids: [one.id] },
        { label: '100nF', quantity: '20', observation_ids: [two.id] },
      ],
    })
    assert.equal(split.status, 200, JSON.stringify(split.value))
    let snapshot = await read()
    const child = (label: string) =>
      snapshot.lots.find((row) => row.label === label && !row.retired)!
    assert.deepEqual(child('22pF').evidence_observation_ids, [one.id])
    assert.deepEqual(child('100nF').evidence_observation_ids, [two.id])

    const moved = await write((client) =>
      regroup(client, writer, {
        base_revision: snapshot.revision,
        moves: [{ observation_id: one.id, to_lot_id: child('100nF').id }],
      }),
    )
    assert.ok(moved.ok && moved.suggested)
    snapshot = await read()
    assert.deepEqual(child('22pF').evidence_observation_ids, [one.id])

    const merged = await restructure({
      kind: 'merge_lots',
      lot_ids: [child('22pF').id, child('100nF').id],
      label: 'All capacitors',
      quantity: '30',
      part_subject_id: null,
      confirm_same_physical_contribution: true,
    })
    assert.equal(merged.status, 200, JSON.stringify(merged.value))
    snapshot = await read()
    assert.deepEqual(
      [...child('All capacitors').evidence_observation_ids!].sort(),
      [one.id, two.id].sort(),
    )
  })
})

test('the observation migration upgrades a database already at the session migration', async () => {
  const { readdir, readFile } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const { isolatedDatabase } = await import('../support/database.ts')
  const { migrate } = await import('../../src/operations/migrate.ts')
  const db = await isolatedDatabase({ migrate: false })
  try {
    const directory = new URL('../../migrations/', import.meta.url)
    const names = (await readdir(directory))
      .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
      .sort()
    const target = names.indexOf('0019_evidence_observations.sql')
    assert.ok(target > 0)
    await transaction(db.pool, async (client) => {
      await client.query(
        'CREATE TABLE schema_migration (name text PRIMARY KEY, sha256 text NOT NULL)',
      )
      for (const name of names.slice(0, target)) {
        const sql = await readFile(new URL(name, directory), 'utf8')
        await client.query(sql)
        await client.query('INSERT INTO schema_migration VALUES ($1,$2)', [
          name,
          createHash('sha256').update(sql).digest('hex'),
        ])
      }
    })
    await migrate(db.pool)
    const applied = await db.pool.query<{ name: string }>(
      "SELECT name FROM schema_migration WHERE name='0019_evidence_observations.sql'",
    )
    assert.equal(applied.rowCount, 1)
    const columns = await db.pool.query<{ column_name: string; column_default: string | null }>(
      `SELECT column_name,column_default FROM information_schema.columns
       WHERE table_name='capture_lot' AND column_name IN ('origin','operator_edited','changed_revision')
       ORDER BY column_name`,
    )
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ['changed_revision', 'operator_edited', 'origin'],
    )
    // A second run is a no-op.
    await migrate(db.pool)
  } finally {
    await db.dispose()
  }
})

test('operator moves, bulk edits and splits mark lots edited, so the lead session only suggests', async () => {
  await withLead(async ({ fixture, batchId, writer, photo, write, read }) => {
    const { operatorRepository } = await import('../../src/operator-review/repository.ts')
    const { grantManual } = await import('../../src/review/grants.ts')
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const operator = operatorRepository(fixture.api.pool, fixture.config)
    const observe = async (x: number, marking: string) => {
      const base = (await read()).revision
      const result = await write((client) =>
        recordObservation(client, writer, {
          base_revision: base,
          evidence_version_id: photo.version,
          region: region(x, 50),
          readings: readings(marking),
        }),
      )
      assert.ok(result.ok)
      return result.id
    }
    const form = async (label: string, ids: string[]) => {
      const base = (await read()).revision
      const result = await write((client) =>
        proposeLot(client, writer, { base_revision: base, label, observation_ids: ids }),
      )
      assert.ok(result.ok)
      return result.id
    }
    const moved = await form('Moved', [await observe(0, 'A')])
    const bulk = await form('Bulk', [await observe(100, 'B')])
    const split = await form('Split', [await observe(200, 'C')])
    await operator.restructure(batchId, randomUUID(), {
      expected_revision: (await read()).revision,
      preview: false,
      change: {
        kind: 'move_lots',
        lot_ids: [moved],
        destination: { kind: 'new', label: 'Operator Part' },
      },
    } as never)
    await operator.bulkEdit(batchId, randomUUID(), {
      expected_revision: (await read()).revision,
      lot_ids: [bulk],
      change: { quantity: { mode: 'set', value: '9' } },
    } as never)
    await operator.restructure(batchId, randomUUID(), {
      expected_revision: (await read()).revision,
      preview: false,
      change: {
        kind: 'split_lot',
        lot_id: split,
        children: [
          { label: 'Split 1', quantity: '1' },
          { label: 'Split 2', quantity: '1' },
        ],
      },
    } as never)
    const snapshot = await read()
    for (const id of [moved, bulk, split]) {
      assert.equal(snapshot.lots.find((lot) => lot.id === id)!.operator_edited, true, id)
    }
    // A Part change aimed at the moved lot changes nothing, and an observation left on the split
    // parent can only be suggested elsewhere.
    const again = await write((client) =>
      proposeLot(client, writer, {
        base_revision: snapshot.revision,
        lot_id: moved,
        observation_ids: snapshot.lots.find((lot) => lot.id === moved)!.evidence_observation_ids!,
        part: { label: 'Agent Part' },
      }),
    )
    assert.ok(again.ok && again.suggested)
    const movedPart = snapshot.lots.find((lot) => lot.id === moved)!.part_subject_id
    assert.equal((await read()).lots.find((lot) => lot.id === moved)!.part_subject_id, movedPart)
    const leftover = snapshot.lots.find((lot) => lot.id === split)!.evidence_observation_ids![0]
    const relinked = await write((client) =>
      regroup(client, writer, {
        base_revision: snapshot.revision,
        moves: [{ observation_id: leftover, to_lot_id: bulk }],
      }),
    )
    assert.ok(relinked.ok && relinked.suggested)
    assert.deepEqual(
      (await read()).lots.find((lot) => lot.id === split)!.evidence_observation_ids,
      [leftover],
    )
  })
})

test('agent writes stop at the batch observation limit with a capacity refusal', async () => {
  await withLead(async ({ fixture, batchId, writer, photo, write }) => {
    // Fill to the limit directly; the next agent observation is refused and nothing changes.
    await fixture.db.pool.query(
      `INSERT INTO capture_evidence_observation(id,batch_id,evidence_version_id,region,readings,origin,agent_session_id,revision)
       SELECT gen_random_uuid(),$1,$2,'{"kind":"lines","from_line":1,"to_line":1}','{"markings":[]}','agent',$3,1
       FROM generate_series(1,1000)`,
      [batchId, photo.version, writer.sessionId],
    )
    // That many already overflows the snapshot, so read the revision from the table.
    const revision = async () =>
      (
        await fixture.db.pool.query<{ revision: string }>(
          'SELECT revision::text AS revision FROM capture_batch WHERE id=$1',
          [batchId],
        )
      ).rows[0].revision
    const before = await revision()
    await assert.rejects(
      write((client) =>
        recordObservation(client, writer, {
          base_revision: before,
          evidence_version_id: photo.version,
          region: region(0),
          readings: readings('One too many'),
        }),
      ),
      /capture_capacity/,
    )
    assert.equal(await revision(), before)
  })
})

test('an agent write that would overflow the snapshot is refused and changes nothing', async () => {
  await withLead(async ({ fixture, batchId, writer, photo, write, read }) => {
    // Long readings fill the snapshot well before the observation count limit.
    const text = 'x'.repeat(2000)
    await fixture.db.pool.query(
      `INSERT INTO capture_evidence_observation(id,batch_id,evidence_version_id,region,readings,origin,agent_session_id,revision)
       SELECT gen_random_uuid(),$1,$2,'{"kind":"lines","from_line":1,"to_line":1}',jsonb_build_object('markings','[]'::jsonb,'text',$4::text),'agent',$3,1
       FROM generate_series(1,80)`,
      [batchId, photo.version, writer.sessionId, text],
    )
    const before = await read()
    assert.ok(before.revision)
    let refused = false
    for (let n = 0; n < 40 && !refused; n += 1) {
      const base = (await read()).revision
      try {
        await write((client) =>
          recordObservation(client, writer, {
            base_revision: base,
            evidence_version_id: photo.version,
            region: region(0),
            readings: { markings: ['y'], text },
          }),
        )
      } catch (error) {
        assert.match(String(error), /capture_capacity/)
        refused = true
      }
    }
    assert.ok(refused)
    // The batch is still readable after the refusal.
    assert.ok((await read()).revision)
  })
})

test('an unexpected tool failure answers with tool_failed instead of leaving the call hanging', async () => {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const { startSessionToolServer } = await import('../../src/agents/tools/server.ts')
  const { issueSessionCapability } = await import('../../src/agents/tools/capability.ts')
  const { database } = await import('../../src/db/database.ts')
  const fixture = await processingFixture()
  // A writer pool that is already closed makes every lot-forming call throw.
  const broken = database(fixture.writer.url)
  await broken.close()
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    writerPool: broken.pool,
    config: fixture.config,
    statusIntervalMs: 60_000,
  })
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture)
    const token = await transaction(fixture.runner.pool, (client) =>
      issueSessionCapability(client, lead.attempt),
    )
    const client = new Client({ name: 'tool-failed-test', version: '1' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    try {
      const result = (
        await client.callTool({
          name: 'regroup',
          arguments: {
            base_revision: capture.batch.revision,
            moves: [{ observation_id: randomUUID(), to_lot_id: randomUUID() }],
          },
        })
      ).structuredContent as { ok: boolean; error?: string }
      assert.deepEqual([result.ok, result.error], [false, 'tool_failed'])
    } finally {
      await client.close()
    }
  } finally {
    await server.close()
    await fixture.dispose()
  }
})

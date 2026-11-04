import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { database } from '../../src/db/database.ts'
import { grantFoundation } from '../../src/operations/grants.ts'
import { grantCapture } from '../../src/capture/grants.ts'
import { captureRepository } from '../../src/capture/repository.ts'
import {
  effectiveSettingsIntent,
  validate,
  type CaptureEditDto,
  type CaptureSettingsIntentDto,
  type CaptureSnapshotDto,
} from '@invimport/contracts'

type BatchSettingsChange = Extract<CaptureEditDto['change'], { kind: 'batch_settings' }>

async function checked(value: Promise<unknown>): Promise<CaptureSnapshotDto> {
  const result = await value
  validate('CaptureSnapshot', result)
  return result as CaptureSnapshotDto
}

/** Restricted runtime role, so missing grants fail rather than pass as the test owner. */
async function fixture() {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const role = `intake_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
  )
  await grantFoundation(db.pool, role)
  await grantCapture(db.pool, role)
  const runtimeUrl = new URL(db.url)
  runtimeUrl.username = role
  runtimeUrl.password = password
  let runtime = database(runtimeUrl.toString())
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  return {
    db,
    identity,
    get repo() {
      return captureRepository(runtime.pool, binding)
    },
    runtime: () => runtime,
    async restart() {
      await runtime.close()
      runtime = database(runtimeUrl.toString())
    },
    async dispose() {
      await runtime.close()
      await db.pool.query(`DROP OWNED BY ${role}`)
      await db.pool.query(`DROP ROLE ${role}`)
      await db.dispose()
    },
  }
}

function observation<M extends 'company' | 'location'>(
  context: string,
  model: M,
  pk: string,
  supplier = true,
) {
  return {
    id: randomUUID(),
    model,
    pk,
    label: model === 'company' ? 'Mouser Electronics' : 'Incoming inspection drawer',
    target_context_id: context,
    observed_at: '2026-11-04T01:02:03.456Z',
    ...(model === 'company'
      ? { mapping: { kind: 'company' as const, manufacturer: false, supplier } }
      : {}),
  }
}

function ref<M extends 'company' | 'location'>(o: {
  id: string
  target_context_id: string
  model: M
  pk: string
}) {
  return { observation_id: o.id, target_context_id: o.target_context_id, model: o.model, pk: o.pk }
}

function settings(
  snapshot: CaptureSnapshotDto,
  change: Omit<BatchSettingsChange, 'kind'>,
): CaptureEditDto {
  return { expected_revision: snapshot.revision, change: { kind: 'batch_settings', ...change } }
}

const autoIntent: CaptureSettingsIntentDto = {
  supplier: { absent: false, selection: { mode: 'unset' } },
  order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
  shared_tags: { manual: [], auto: false },
}

test('batch settings retain intent, derived legacy context, distinct notes and Remove history across restart', async () => {
  const f = await fixture()
  try {
    let saved = await checked(f.repo.create(randomUUID(), { title: 'Legacy', note: 'first' }))
    saved = await checked(
      f.repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'add_lot', label: 'Opened packet', note: '', part_subject_id: null },
      }),
    )
    const lot = saved.lots[0].id
    saved = await checked(
      f.repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'settings',
          quantity: { mode: 'set', value: '9999999999999.999999' },
          context: {
            supplier: { mode: 'unset' },
            purchase_date: { mode: 'set', value: '2026-02-28' },
            tags: { mode: 'set', value: ['incoming', 'Bench A'] },
          },
        },
      }),
    )
    saved = await checked(
      f.repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'lot',
          id: lot,
          quantity: { mode: 'set', value: '0.000001' },
          context: {
            supplier: { mode: 'inherit' },
            purchase_date: { mode: 'clear' },
            tags: { mode: 'unknown' },
          },
        },
      }),
    )
    // Migration: legacy tags become manual intent with Auto off; nothing is rewritten.
    assert.equal(saved.settings_intent, undefined)
    assert.deepEqual(effectiveSettingsIntent(saved).shared_tags, {
      manual: ['incoming', 'Bench A'],
      auto: false,
    })
    const legacyLotContext = saved.context?.find((record) => record.subject_id === lot)

    const supplier = observation(f.identity.context, 'company', '9007199254740993')
    const location = observation(f.identity.context, 'location', '9007199254740994')
    await f.repo.observe(saved.id, randomUUID(), supplier)
    await f.repo.observe(saved.id, randomUUID(), location)
    saved = await checked(f.repo.read(saved.id))
    const intent: CaptureSettingsIntentDto = {
      supplier: { absent: false, selection: { mode: 'existing', reference: ref(supplier) } },
      order: {
        reference: { mode: 'manual', value: 'PO-0042 ' },
        purchase_date: { mode: 'manual', value: '2026-11-03' },
      },
      shared_tags: { manual: ['incoming', 'reel'], auto: true },
    }
    const appendedNotes = saved.notes.length
    const key = randomUUID()
    const input = settings(saved, {
      title: 'Reel intake',
      default_location: { mode: 'set', value: ref(location) },
      intent,
      notes: { batch: 'Line one\nLine two', order: 'Order-scoped text' },
      drafts: [],
    })
    saved = await checked(f.repo.edit(saved.id, key, input))
    assert.equal(saved.title, 'Reel intake')
    assert.deepEqual(saved.settings_intent?.value, intent)
    assert.equal(saved.settings_intent?.version, saved.revision)
    assert.equal(saved.settings_intent?.actor_id, f.identity.actor)
    assert.deepEqual(saved.defaults.location, { mode: 'set', value: ref(location) })
    assert.deepEqual(saved.defaults.quantity, { mode: 'set', value: '9999999999999.999999' })
    assert.deepEqual(
      saved.setting_notes?.map((record) => [record.scope, record.text]),
      [
        ['batch', 'Line one\nLine two'],
        ['order', 'Order-scoped text'],
      ],
    )
    const batchContext = saved.context?.find((record) => record.subject_id === null)
    assert.deepEqual(batchContext?.value, {
      supplier: { mode: 'set', value: ref(supplier) },
      purchase_date: { mode: 'set', value: '2026-11-03' },
      tags: { mode: 'set', value: ['incoming', 'reel'] },
    })
    assert.deepEqual(
      saved.context?.find((record) => record.subject_id === lot),
      legacyLotContext,
      'explicit lot overrides survive the batch change unchanged',
    )
    assert.equal(
      saved.notes.length,
      appendedNotes,
      'setting notes never append to immutable human notes',
    )
    assert.deepEqual(await f.repo.edit(saved.id, key, input), saved, 'exact replay')
    await assert.rejects(
      f.repo.edit(saved.id, key, {
        ...input,
        change: { ...(input.change as BatchSettingsChange), title: 'Other' },
      }),
    )

    // Remove retires current batch text; history and the separate order note remain.
    const removedBatch = await checked(
      f.repo.edit(
        saved.id,
        randomUUID(),
        settings(saved, {
          title: 'Reel intake',
          default_location: { mode: 'set', value: ref(location) },
          intent,
          notes: { batch: null, order: 'Order-scoped text' },
          drafts: [],
        }),
      ),
    )
    assert.deepEqual(
      removedBatch.setting_notes?.map((record) => [record.scope, record.text, record.version]),
      [
        ['batch', null, removedBatch.revision],
        ['order', 'Order-scoped text', saved.revision],
      ],
    )
    const history = await f.db.pool.query(
      `SELECT scope,text FROM capture_setting_note WHERE batch_id=$1 ORDER BY scope,version`,
      [saved.id],
    )
    assert.deepEqual(
      history.rows.map((row) => [row.scope, row.text]),
      [
        ['batch', 'Line one\nLine two'],
        ['batch', null],
        ['order', 'Order-scoped text'],
      ],
    )
    const intentRows = await f.db.pool.query(
      'SELECT count(*)::int AS count FROM capture_settings_intent WHERE batch_id=$1',
      [saved.id],
    )
    assert.equal(intentRows.rows[0].count, 1, 'unchanged intent is not re-versioned')

    await f.restart()
    assert.deepEqual(await f.repo.read(saved.id), removedBatch)
    await assert.rejects(
      f
        .runtime()
        .pool.query('UPDATE capture_setting_note SET text=$1 WHERE batch_id=$2', [
          'rewritten',
          saved.id,
        ]),
    )
    await assert.rejects(
      f.db.pool.query('DELETE FROM capture_settings_intent WHERE batch_id=$1', [saved.id]),
      /immutable|authority/,
    )
  } finally {
    await f.dispose()
  }
})

test('reference drafts keep stable identity, fixed kind, validated references and retirement history', async () => {
  const f = await fixture()
  try {
    let saved = await checked(f.repo.create(randomUUID(), { title: 'Drafts', note: '' }))
    const parent = observation(f.identity.context, 'location', '41')
    const nonSupplier = observation(f.identity.context, 'company', '42', false)
    await f.repo.observe(saved.id, randomUUID(), parent)
    await f.repo.observe(saved.id, randomUUID(), nonSupplier)
    saved = await checked(f.repo.read(saved.id))
    const company = randomUUID()
    const drawer = randomUUID()
    const drafts: BatchSettingsChange['drafts'] = [
      {
        draft_id: company,
        kind: 'company',
        value: { name: 'New Supplier Pty', description: '', also_manufacturer: true, logo: null },
      },
      {
        draft_id: drawer,
        kind: 'location',
        value: { name: 'Incoming drawer', description: 'Top', parent: ref(parent) },
      },
    ]
    const intent: CaptureSettingsIntentDto = {
      ...autoIntent,
      supplier: { absent: false, selection: { mode: 'draft', draft_id: company } },
    }
    const base = {
      title: 'Drafts',
      default_location: { mode: 'draft' as const, draft_id: drawer },
      intent,
      notes: { batch: null, order: null },
      drafts,
    }
    saved = await checked(f.repo.edit(saved.id, randomUUID(), settings(saved, base)))
    assert.deepEqual(
      saved.reference_drafts?.map((draft) => [draft.draft_id, draft.kind, draft.value]),
      drafts
        .map((draft) => [draft.draft_id, draft.kind, draft.value])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      'active drafts in stable draft-ID order',
    )
    assert.deepEqual(saved.defaults.location, { mode: 'unset' })
    assert.deepEqual(saved.settings_intent?.value, intent)
    assert.equal(saved.settings_intent?.default_location_draft, drawer)
    assert.deepEqual(
      saved.context?.find((record) => record.subject_id === null)?.value.supplier,
      { mode: 'unknown' },
      'a pending new supplier is not an observed company',
    )
    assert.equal(effectiveSettingsIntent(saved).supplier.selection.mode, 'draft')

    const invalid: Array<[string, Omit<BatchSettingsChange, 'kind'>]> = [
      ['kind change', { ...base, drafts: [{ ...drafts[1], draft_id: company }, drafts[1]] }],
      [
        'supplier references location draft',
        {
          ...base,
          intent: {
            ...intent,
            supplier: { absent: false, selection: { mode: 'draft', draft_id: drawer } },
          },
        },
      ],
      [
        'default references company draft',
        { ...base, default_location: { mode: 'draft', draft_id: company } },
      ],
      ['missing referenced draft', { ...base, drafts: [drafts[1]] }],
      ['duplicate draft id', { ...base, drafts: [drafts[0], drafts[0], drafts[1]] }],
      [
        'foreign parent',
        {
          ...base,
          drafts: [
            drafts[0],
            {
              ...drafts[1],
              value: {
                ...drafts[1].value,
                parent: { ...ref(parent), observation_id: randomUUID() },
              },
            } as BatchSettingsChange['drafts'][number],
          ],
        },
      ],
      [
        'non-supplier company',
        {
          ...base,
          intent: {
            ...intent,
            supplier: {
              absent: false,
              selection: { mode: 'existing', reference: ref(nonSupplier) as never },
            },
          },
        },
      ],
      [
        'missing logo media',
        {
          ...base,
          drafts: [
            {
              ...drafts[0],
              value: {
                ...drafts[0].value,
                logo: { evidence_id: randomUUID(), version_id: randomUUID() },
              },
            } as BatchSettingsChange['drafts'][number],
            drafts[1],
          ],
        },
      ],
    ]
    for (const [label, change] of invalid) {
      await assert.rejects(f.repo.edit(saved.id, randomUUID(), settings(saved, change)), label)
      assert.deepEqual(await f.repo.read(saved.id), saved, `${label} rolls back`)
    }

    // Retained PNG logos are accepted; PDFs are not image logos.
    const media = async (mediaType: string) => {
      const digest = createHash('sha256').update(randomUUID()).digest()
      const evidence = randomUUID()
      const version = randomUUID()
      await f.db.pool.query('INSERT INTO media_batch(batch_id) VALUES($1) ON CONFLICT DO NOTHING', [
        saved.id,
      ])
      await f.db.pool.query('INSERT INTO media_blob(digest,byte_size) VALUES($1,10)', [digest])
      await f.db.pool.query(
        'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
        [evidence, saved.id, 'logo.png', f.identity.actor],
      )
      await f.db.pool.query(
        `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id)
         VALUES($1,$2,$3,'original',$4,$5,$6)`,
        [version, saved.id, evidence, digest, mediaType, f.identity.actor],
      )
      return { evidence_id: evidence, version_id: version }
    }
    const withLogo = (logo: { evidence_id: string; version_id: string }) => ({
      ...base,
      drafts: [
        {
          ...drafts[0],
          value: { ...drafts[0].value, logo },
        } as BatchSettingsChange['drafts'][number],
        drafts[1],
      ],
    })
    const pdf = await media('application/pdf')
    await assert.rejects(f.repo.edit(saved.id, randomUUID(), settings(saved, withLogo(pdf))))
    const png = await media('image/png')
    saved = await checked(f.repo.edit(saved.id, randomUUID(), settings(saved, withLogo(png))))
    const logoDraft = saved.reference_drafts?.find((draft) => draft.draft_id === company)
    assert.deepEqual(logoDraft?.kind === 'company' ? logoDraft.value.logo : null, png)

    // Omitting a draft from a complete save retires it; history stays.
    saved = await checked(
      f.repo.edit(
        saved.id,
        randomUUID(),
        settings(saved, {
          ...base,
          intent: autoIntent,
          default_location: { mode: 'unset' },
          drafts: [drafts[1]],
        }),
      ),
    )
    assert.deepEqual(
      saved.reference_drafts?.map((draft) => draft.draft_id),
      [drawer],
    )
    const rows = await f.db.pool.query(
      `SELECT draft_id,retired FROM capture_reference_draft WHERE batch_id=$1 AND draft_id=$2 ORDER BY version`,
      [saved.id, company],
    )
    assert.deepEqual(
      rows.rows.map((row) => row.retired),
      [false, false, true],
    )
  } finally {
    await f.dispose()
  }
})

test('legacy context writes cannot diverge from intent, and archived batches refuse settings', async () => {
  const f = await fixture()
  try {
    let saved = await checked(f.repo.create(randomUUID(), { title: 'Guard', note: '' }))
    saved = await checked(
      f.repo.edit(
        saved.id,
        randomUUID(),
        settings(saved, {
          title: 'Guard',
          default_location: { mode: 'unset' },
          intent: { ...autoIntent, shared_tags: { manual: [], auto: true } },
          notes: { batch: null, order: null },
          drafts: [],
        }),
      ),
    )
    assert.deepEqual(saved.setting_notes, undefined, 'no note version without text')
    await assert.rejects(
      f.repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'settings',
          context: {
            supplier: { mode: 'clear' },
            purchase_date: { mode: 'unset' },
            tags: { mode: 'unset' },
          },
        },
      }),
      /settings_intent_superseded/,
    )
    // Legacy title/default edits without context remain compatible.
    saved = await checked(
      f.repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'settings', title: 'Renamed by legacy' },
      }),
    )
    saved = await checked(
      f.repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'batch', archived: true },
      }),
    )
    await assert.rejects(
      f.repo.edit(
        saved.id,
        randomUUID(),
        settings(saved, {
          title: 'Archived',
          default_location: { mode: 'unset' },
          intent: autoIntent,
          notes: { batch: 'x', order: null },
          drafts: [],
        }),
      ),
      /batch_archived/,
    )
    await assert.rejects(
      f.repo.edit(
        saved.id,
        randomUUID(),
        settings(
          { ...saved, revision: (BigInt(saved.revision) - 1n).toString() },
          {
            title: 'Stale',
            default_location: { mode: 'unset' },
            intent: autoIntent,
            notes: { batch: null, order: null },
            drafts: [],
          },
        ),
      ),
      /revision_conflict/,
    )
  } finally {
    await f.dispose()
  }
})

test('migration 0014 upgrades a legacy batch without rewriting choices, then retains new intent across restart', async () => {
  const { readFile, readdir } = await import('node:fs/promises')
  const { migrate } = await import('../../src/operations/migrate.ts')
  const db = await isolatedDatabase({ migrate: false })
  try {
    await db.pool.query('CREATE TABLE schema_migration(name text PRIMARY KEY,sha256 text NOT NULL)')
    const directory = new URL('../../migrations/', import.meta.url)
    for (const name of (await readdir(directory))
      .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < '0014')
      .sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8')
      await db.pool.query(sql)
      await db.pool.query('INSERT INTO schema_migration VALUES($1,$2)', [
        name,
        createHash('sha256').update(sql).digest('hex'),
      ])
    }
    const identity = await seedAuthority(db.pool)
    const batchId = randomUUID()
    const archivedId = randomUUID()
    const supplier = observation(identity.context, 'company', '9223372036854775807')
    const location = observation(identity.context, 'location', '9007199254740993')
    for (const [id, title] of [
      [batchId, 'Legacy batch'],
      [archivedId, 'Archived legacy'],
    ]) {
      const source = randomUUID()
      const stream = randomUUID()
      await db.pool.query(
        'INSERT INTO capture_source(id,namespace_key,created_by) VALUES($1,$2,$3)',
        [source, `native_batch:${source}`, identity.actor],
      )
      await db.pool.query('INSERT INTO ui_stream(id,stream_key) VALUES($1,$2)', [
        stream,
        `capture:${id}`,
      ])
      await db.pool.query(
        `INSERT INTO capture_batch(id,source_id,actor_id,target_id,target_context_id,stream_id,title,archived)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          source,
          identity.actor,
          identity.target,
          identity.context,
          stream,
          title,
          id === archivedId,
        ],
      )
    }
    for (const o of [supplier, location]) {
      await db.pool.query(
        `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label,observed_at,mapping)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9)`,
        [
          o.id,
          batchId,
          identity.target,
          identity.context,
          o.model,
          o.pk,
          o.label,
          o.observed_at,
          'mapping' in o ? o.mapping : null,
        ],
      )
    }
    const legacyContext = {
      supplier: { mode: 'set', value: ref(supplier) },
      purchase_date: { mode: 'set', value: '2024-02-29' },
      tags: { mode: 'set', value: ['Ω resistor', 'incoming'] },
    }
    await db.pool.query(
      'INSERT INTO capture_context(id,batch_id,subject_id,version,value,actor_id) VALUES($1,$2,NULL,1,$3,$4)',
      [randomUUID(), batchId, legacyContext, identity.actor],
    )
    await db.pool.query(
      `INSERT INTO capture_selection(id,batch_id,subject_id,field,version,value,actor_id)
       VALUES($1,$2,NULL,'quantity',1,$3,$4)`,
      [randomUUID(), batchId, { mode: 'set', value: '9999999999999.999999' }, identity.actor],
    )
    await migrate(db.pool)

    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    let repo = captureRepository(db.pool, binding)
    let saved = await checked(repo.read(batchId))
    assert.equal(saved.settings_intent, undefined)
    assert.equal(saved.setting_notes, undefined)
    assert.equal(saved.reference_drafts, undefined)
    assert.deepEqual(saved.defaults.quantity, { mode: 'set', value: '9999999999999.999999' })
    assert.deepEqual(saved.context?.[0].value, legacyContext)
    assert.deepEqual(effectiveSettingsIntent(saved), {
      supplier: { absent: false, selection: { mode: 'existing', reference: ref(supplier) } },
      order: {
        reference: { mode: 'auto' },
        purchase_date: { mode: 'manual', value: '2024-02-29' },
      },
      shared_tags: { manual: ['Ω resistor', 'incoming'], auto: false },
    })

    const archived = await checked(repo.read(archivedId))
    await assert.rejects(
      repo.edit(
        archivedId,
        randomUUID(),
        settings(archived, {
          title: 'Archived legacy',
          default_location: { mode: 'unset' },
          intent: autoIntent,
          notes: { batch: null, order: null },
          drafts: [],
        }),
      ),
      /batch_archived/,
    )

    const draftId = randomUUID()
    const intent = { ...effectiveSettingsIntent(saved) }
    saved = await checked(
      repo.edit(
        batchId,
        randomUUID(),
        settings(saved, {
          title: 'Legacy batch',
          default_location: { mode: 'draft', draft_id: draftId },
          intent,
          notes: { batch: 'Added after upgrade', order: null },
          drafts: [
            {
              draft_id: draftId,
              kind: 'location',
              value: { name: 'Shelf 3', description: '', parent: ref(location) },
            },
          ],
        }),
      ),
    )
    assert.deepEqual(saved.defaults.quantity, { mode: 'set', value: '9999999999999.999999' })
    assert.deepEqual(
      saved.context?.find((record) => record.subject_id === null)?.value,
      legacyContext,
      'an unchanged effective intent does not re-version legacy context',
    )
    const revisionBytes = await db.pool.query(
      'SELECT revision::text,command_digest FROM capture_revision WHERE batch_id=$1 ORDER BY revision',
      [batchId],
    )

    await db.close()
    const reopened = database(db.url)
    try {
      repo = captureRepository(reopened.pool, binding)
      assert.deepEqual(await repo.read(batchId), saved)
      assert.deepEqual(
        (
          await reopened.pool.query(
            'SELECT revision::text,command_digest FROM capture_revision WHERE batch_id=$1 ORDER BY revision',
            [batchId],
          )
        ).rows,
        revisionBytes.rows,
      )
      for (const table of [
        'capture_settings_intent',
        'capture_setting_note',
        'capture_reference_draft',
        'capture_reference_draft_identity',
      ]) {
        await assert.rejects(
          reopened.pool.query(`DELETE FROM ${table} WHERE batch_id=$1`, [batchId]),
          {
            code: '23000',
          },
        )
      }
    } finally {
      await reopened.close()
    }
  } finally {
    const admin = database(process.env.INTAKE_TEST_ADMIN_URL!)
    try {
      await admin.pool.query(`DROP DATABASE IF EXISTS ${db.name} WITH (FORCE)`)
    } finally {
      await admin.close()
    }
  }
})

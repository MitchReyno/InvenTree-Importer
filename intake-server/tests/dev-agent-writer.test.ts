import assert from 'node:assert/strict'
import { mkdtemp, writeFile, symlink, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  AGENT_WRITER_FILE,
  readAgentWriterUrl,
  ensureAgentWriter,
} from '../src/dev/agent-writer.ts'

const databaseName = `intake_dev_${'a'.repeat(32)}`
const writerUrl = `postgresql://intake_agent_writer_0123456789abcdef0123456789abcdef:secret@127.0.0.1:55433/${databaseName}`

async function directory() {
  return mkdtemp(join(tmpdir(), 'agent-writer-'))
}

test('a private writer file returns its login for that database', async () => {
  const root = await directory()
  await writeFile(join(root, AGENT_WRITER_FILE), JSON.stringify({ url: writerUrl }), {
    mode: 0o600,
  })
  assert.equal(await readAgentWriterUrl(root, databaseName), writerUrl)
  await rm(root, { recursive: true })
})

test('a missing writer file is absent, and a symlink or open file is refused', async () => {
  const root = await directory()
  assert.equal(await readAgentWriterUrl(root, databaseName), undefined)
  await symlink(join(root, 'elsewhere'), join(root, AGENT_WRITER_FILE))
  await assert.rejects(readAgentWriterUrl(root, databaseName), /private_agent_writer_required/)
  await rm(join(root, AGENT_WRITER_FILE))
  await writeFile(join(root, AGENT_WRITER_FILE), JSON.stringify({ url: writerUrl }), {
    mode: 0o644,
  })
  await chmod(join(root, AGENT_WRITER_FILE), 0o644)
  await assert.rejects(readAgentWriterUrl(root, databaseName), /private_agent_writer_required/)
  await rm(root, { recursive: true })
})

test('a writer login for another database is refused', async () => {
  const root = await directory()
  const other = `intake_dev_${'b'.repeat(32)}`
  await writeFile(
    join(root, AGENT_WRITER_FILE),
    JSON.stringify({
      url: `postgresql://intake_agent_writer_0123456789abcdef0123456789abcdef:secret@127.0.0.1:55433/${other}`,
    }),
    { mode: 0o600 },
  )
  await assert.rejects(readAgentWriterUrl(root, databaseName), /owned_dev_database_required/)
  await rm(root, { recursive: true })
})

test('misplaced API credentials are refused before any privilege-changing query', async () => {
  const root = await directory()
  try {
    const apiUrl = writerUrl.replace(
      'intake_agent_writer_0123456789abcdef0123456789abcdef',
      'intake_api',
    )
    await writeFile(join(root, AGENT_WRITER_FILE), JSON.stringify({ url: apiUrl }), { mode: 0o600 })
    let queries = 0
    const pool = {
      query: async () => {
        queries++
        throw new Error('unexpected_query')
      },
    } as unknown as import('pg').Pool
    await assert.rejects(
      ensureAgentWriter(pool, root, writerUrl),
      /dedicated_agent_writer_required/,
    )
    assert.equal(queries, 0)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('another server or an unbound role is refused before grants or credential use', async () => {
  const root = await directory()
  try {
    await writeFile(join(root, AGENT_WRITER_FILE), JSON.stringify({ url: writerUrl }), {
      mode: 0o600,
    })
    const queries: string[] = []
    const pool = {
      query: async (sql: string) => {
        queries.push(sql)
        return { rows: [{ valid: false }] }
      },
    } as unknown as import('pg').Pool
    await assert.rejects(
      ensureAgentWriter(pool, root, writerUrl.replace('55433', '55434')),
      /agent_writer_binding_mismatch/,
    )
    assert.equal(queries.length, 0)
    await assert.rejects(ensureAgentWriter(pool, root, writerUrl), /agent_writer_binding_mismatch/)
    assert.equal(queries.length, 1)
    assert.match(queries[0], /^SELECT/)
  } finally {
    await rm(root, { recursive: true })
  }
})

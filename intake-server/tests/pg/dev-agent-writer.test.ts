import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDatabase } from '../support/database.ts'
import { ensureAgentWriter, AGENT_WRITER_FILE } from '../../src/dev/agent-writer.ts'

test(
  'writer provisioning reuses its dedicated identity and checks login before restoring grants',
  { timeout: 30000 },
  async () => {
    const db = await isolatedDatabase({ retainedDev: true })
    const root = await mkdtemp(join(tmpdir(), 'writer-provision-'))
    let role: string | undefined
    try {
      const address = await ensureAgentWriter(db.pool, root, db.url)
      role = new URL(address).username
      assert.match(role, /^intake_agent_writer_[a-f0-9]{32}$/)
      assert.equal(await ensureAgentWriter(db.pool, root, db.url), address)
      await db.pool.query(`REVOKE UPDATE(progress) ON agent_session FROM ${role}`)
      const corrupt = new URL(address)
      corrupt.password = 'deliberately-wrong'
      await writeFile(join(root, AGENT_WRITER_FILE), JSON.stringify({ url: corrupt.toString() }), {
        mode: 0o600,
      })
      await assert.rejects(ensureAgentWriter(db.pool, root, db.url), /agent_writer_login_failed/)
      const before = await db.pool.query(
        "SELECT has_column_privilege($1, 'agent_session', 'progress', 'UPDATE') AS permitted",
        [role],
      )
      assert.equal(before.rows[0].permitted, false)
      await writeFile(join(root, AGENT_WRITER_FILE), JSON.stringify({ url: address }), {
        mode: 0o600,
      })
      await ensureAgentWriter(db.pool, root, db.url)
      const after = await db.pool.query(
        "SELECT has_column_privilege($1, 'agent_session', 'progress', 'UPDATE') AS permitted",
        [role],
      )
      assert.equal(after.rows[0].permitted, true)
    } finally {
      if (role) {
        await db.pool.query(`DROP OWNED BY ${role}`)
        await db.pool.query(`DROP ROLE ${role}`)
      }
      await db.dispose()
      await rm(root, { recursive: true })
    }
  },
)

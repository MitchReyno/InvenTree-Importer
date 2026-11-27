import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const filename = 'claude.sqlite'

/**
 * This database lives in the private guest volume, outside application backups. `credential_meta`
 * holds each change's time with the revision it made: a side table, because an older image inserts
 * into `credential` positionally and ignores it, so its changes leave no matching time.
 */
export function credentialStore(directory: string, now = () => new Date()) {
  const db = new DatabaseSync(join(directory, filename))
  db.exec(`PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS credential (
      id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, token TEXT
    );
    CREATE TABLE IF NOT EXISTS credential_meta (
      id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, saved_at TEXT NOT NULL
    );`)
  db.prepare('INSERT OR IGNORE INTO credential VALUES (1, ?, NULL)').run(randomUUID())
  const update = db.prepare('UPDATE credential SET revision=?, token=? WHERE id=1 AND revision=?')
  const record = db.prepare(`
    INSERT INTO credential_meta(id, revision, saved_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, saved_at=excluded.saved_at`)

  const status = () =>
    db.prepare('SELECT revision, token IS NOT NULL AS configured FROM credential WHERE id=1').get()!

  return {
    status() {
      const { revision, configured } = status()
      return { revision: String(revision), configured: configured === 1 }
    },
    change(revision: string, token: string | null) {
      const next = randomUUID()
      db.exec('BEGIN IMMEDIATE')
      try {
        const changed = update.run(next, token, revision).changes === 1
        if (changed) {
          record.run(next, now().toISOString())
        }
        db.exec('COMMIT')
        return changed
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close: () => db.close(),
  }
}

export interface ClaudeCredentialStatus {
  configured: boolean
  revision: string
  /** The save time recorded for the current revision, or null when none was. */
  saved_at: string | null
}

/** Reads whether a token is stored, over a read-only connection that cannot change the store. */
export function readClaudeStatus(directory: string): ClaudeCredentialStatus {
  const db = new DatabaseSync(join(directory, filename), { readOnly: true })
  try {
    const recorded = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='credential_meta'")
      .get()
    const row = db
      .prepare(
        recorded
          ? `SELECT credential.revision, credential.token IS NOT NULL AS configured, meta.saved_at
            FROM credential
            LEFT JOIN credential_meta meta ON meta.id = 1 AND meta.revision = credential.revision
            WHERE credential.id = 1`
          : `SELECT revision, token IS NOT NULL AS configured, NULL AS saved_at
            FROM credential WHERE id = 1`,
      )
      .get()
    if (!row || typeof row.revision !== 'string') {
      throw new Error('claude_store_unavailable')
    }
    const configured = row.configured === 1
    const savedAt = configured && typeof row.saved_at === 'string' ? row.saved_at : null
    return { configured, revision: row.revision, saved_at: savedAt }
  } finally {
    db.close()
  }
}

export function readClaudeToken(directory: string) {
  const db = new DatabaseSync(join(directory, filename), { readOnly: true })
  try {
    const token = db.prepare('SELECT token FROM credential WHERE id=1').get()?.token
    return typeof token === 'string' ? token : undefined
  } finally {
    db.close()
  }
}

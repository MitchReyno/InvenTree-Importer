import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const filename = 'claude.sqlite'

/** This database lives in the private guest volume, outside application backups. */
export function credentialStore(directory: string) {
  const db = new DatabaseSync(join(directory, filename))
  db.exec(`PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS credential (
      id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, token TEXT
    );`)
  db.prepare('INSERT OR IGNORE INTO credential VALUES (1, ?, NULL)').run(randomUUID())

  const status = () =>
    db.prepare('SELECT revision, token IS NOT NULL AS configured FROM credential WHERE id=1').get()!

  return {
    status() {
      const { revision, configured } = status()
      return { revision, configured: configured === 1 }
    },
    change(revision: string, token: string | null) {
      return (
        db
          .prepare('UPDATE credential SET revision=?, token=? WHERE id=1 AND revision=?')
          .run(randomUUID(), token, revision).changes === 1
      )
    },
    close: () => db.close(),
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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativePgTools } from '#/operations/pg-tools.ts'

test(
  'native maintenance subprocesses scrub inherited settings, keep synthetic credentials out of argv and redact failures',
  { timeout: 10000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'intake-pg-tools-'))
    const path = process.env.PATH
    process.env.PATH = root
    process.env.INTAKE_SHOULD_NOT_REACH_CHILD = 'ambient-value'
    try {
      await writeFile(
        join(root, 'pg_dump'),
        `#!/bin/sh
[ "$PGPASSWORD" = "synthetic-password" ] || exit 41
[ "$PGUSER" = "synthetic-operator" ] || exit 42
[ "$PGDATABASE" = "intake_fixture" ] || exit 43
[ -z "$INTAKE_SHOULD_NOT_REACH_CHILD" ] || exit 44
for arg in "$@"; do
  case "$arg" in *synthetic-password*) exit 45;; esac
done
printf 'owned subprocess output'
`,
        { mode: 0o700 },
      )
      await writeFile(
        join(root, 'pg_restore'),
        '#!/bin/sh\nprintf "sensitive synthetic-password diagnostic" >&2\nexit 7\n',
        { mode: 0o700 },
      )
      const url =
        'postgresql://synthetic-operator:synthetic-password@127.0.0.1:55432/intake_fixture'
      const output = join(root, 'dump')
      await nativePgTools.dump(url, 'synthetic-snapshot', output)
      assert.equal((await readFile(output)).toString(), 'owned subprocess output')
      await assert.rejects(
        nativePgTools.restore(url, output),
        (error) =>
          error instanceof Error &&
          error.message === 'postgres_tool_failed' &&
          !error.message.includes('synthetic-password'),
      )
      await assert.rejects(
        nativePgTools.dump(
          'postgresql://operator@127.0.0.1/intake_fixture',
          'snapshot',
          join(root, 'no-auth'),
        ),
        /explicit_local_operational_database_required/,
      )
      await assert.rejects(
        nativePgTools.dump(
          'postgresql://operator:synthetic-password@127.0.0.1/host=example.invalid',
          'snapshot',
          join(root, 'invalid-name'),
        ),
        /explicit_local_operational_database_required/,
      )
      process.env.PATH = join(root, 'missing-bin')
      await assert.rejects(
        nativePgTools.dump(url, 'snapshot', join(root, 'missing-output')),
        /postgres_tool_failed/,
      )
    } finally {
      process.env.PATH = path
      delete process.env.INTAKE_SHOULD_NOT_REACH_CHILD
    }
  },
)

import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { once } from 'node:events'
import type { PgTools } from '#/operations/pg-tools.ts'
import { PG } from '#/dev/pg-identity.ts'

/** Same owned PostgreSQL17 binary, lease and database; no host package install or credential argv. */
async function postgres(
  tool: string,
  databaseUrl: string,
  args: string[],
  output?: string,
  input?: string,
) {
  const url = new URL(databaseUrl)
  const container = process.env.INTAKE_TEST_PG_CONTAINER ?? PG.container
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container))
    throw new Error('owned_postgres_container_required')
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      'PGPASSWORD',
      '-e',
      'PGUSER',
      '-e',
      'PGDATABASE',
      container,
      tool,
      ...args,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: url.pathname.slice(1),
      },
      stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'pipe'],
    },
  )
  let diagnostic = ''
  child.stderr!.on('data', (bytes) => {
    if (diagnostic.length < 8192) diagnostic += bytes.toString()
  })
  const exited = once(child, 'exit')
  const copied = output
    ? pipeline(child.stdout!, createWriteStream(output, { flags: 'wx', mode: 0o600 }))
    : Promise.resolve()
  const supplied = input ? pipeline(createReadStream(input), child.stdin!) : Promise.resolve()
  const [[code]] = await Promise.all([exited, copied, supplied])
  if (code !== 0) throw new Error(`owned_postgres_tool_failed:${diagnostic}`)
}
export const ownedPgTools: PgTools = {
  dump: (url, snapshot, output) =>
    postgres(
      'pg_dump',
      url,
      ['--format=custom', '--no-owner', '--no-acl', '--snapshot=' + snapshot],
      output,
    ),
  restore: (url, source) =>
    postgres(
      'pg_restore',
      url,
      [
        '--no-owner',
        '--no-acl',
        '--single-transaction',
        '--exit-on-error',
        '--dbname=' + new URL(url).pathname.slice(1),
      ],
      undefined,
      source,
    ),
}

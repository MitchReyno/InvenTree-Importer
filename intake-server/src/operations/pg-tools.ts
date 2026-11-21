import { spawn } from 'node:child_process'
import { devNull } from 'node:os'
import { createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { once } from 'node:events'
import { MAX_ARCHIVE_BYTES } from './archive-model.ts'
import { operationalDatabase } from './config.ts'

export interface PgTools {
  dump: (databaseUrl: string, snapshot: string, destination: string) => Promise<void>
  restore: (databaseUrl: string, source: string) => Promise<void>
}

function environment(databaseUrl: string) {
  const { url, name } = operationalDatabase(databaseUrl)
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGDATABASE: name,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: '5',
    PGPASSFILE: devNull,
    PGSSLMODE: 'disable',
    PGAPPNAME: 'bench-intake-maintenance',
  }
}

async function run(tool: string, args: string[], databaseUrl: string, output?: string) {
  const child = spawn(tool, args, {
    env: environment(databaseUrl),
    stdio: ['ignore', output ? 'pipe' : 'ignore', 'pipe'],
  })
  const exited = once(child, 'exit')
  let killDeadline: NodeJS.Timeout | undefined

  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }
    child.kill('SIGTERM')
    killDeadline ??= setTimeout(() => child.kill('SIGKILL'), 2000)
  }

  let stderrSize = 0
  child.stderr!.on('data', (bytes: Buffer) => {
    stderrSize += bytes.length
    if (stderrSize > 65536) {
      terminate()
    }
  })
  let outputSize = 0
  const bound = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      outputSize += chunk.length
      done(outputSize > MAX_ARCHIVE_BYTES ? new Error('database_archive_limit') : null, chunk)
    },
  })
  const timeout = setTimeout(terminate, 120000)
  try {
    const copied = output
      ? pipeline(child.stdout!, bound, createWriteStream(output, { flags: 'wx', mode: 0o600 }))
      : Promise.resolve()
    const [[code]] = await Promise.all([exited, copied])
    if (code !== 0) {
      throw new Error('postgres_tool_failed')
    }
  } catch {
    terminate()
    await exited.catch(() => undefined)
    throw new Error('postgres_tool_failed')
  } finally {
    clearTimeout(timeout)
    clearTimeout(killDeadline)
  }
}

/** Native tools use private environment injection; credentials never enter argv, logs or archives. */
export const nativePgTools: PgTools = {
  dump: (url, snapshot, destination) =>
    run(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', '--snapshot=' + snapshot],
      url,
      destination,
    ),
  restore: (url, source) =>
    run(
      'pg_restore',
      [
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--single-transaction',
        '--dbname=' + operationalDatabase(url).name,
        source,
      ],
      url,
    ),
}

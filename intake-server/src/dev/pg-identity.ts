import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { developmentAdminUrl } from './postgres-url.ts'

// Erasable TypeScript only: the .cjs dev scripts load this module through Node's type stripping.

/** The shared development PostgreSQL: the local InvenTree stack's own inventree-db service. */
export const PG = {
  host: '127.0.0.1',
  port: 55433,
  project: 'bench-inventree-dev',
  service: 'inventree-db',
  container: 'bench-inventree-dev-db',
  volume: 'bench-inventree-dev-db',
  ownerLabel: 'bench-intake.owner',
  owner: 'inventree-dev',
} as const

/** Must match tooling/inventree-dev/compose.yaml; a running server that differs is drift. */
export const ALLOCATION = {
  image: 'postgres:17',
  command: ['postgres', '-c', 'max_connections=120', '-c', 'shared_buffers=64MB'],
  memory: 512 * 1024 * 1024,
  nanoCpus: 1_000_000_000,
  pids: 256,
} as const

export const SERVER_STATE_FILE = 'inventree-db.json'
export const SERVER_ENV_FILE = 'inventree-db.env'

export interface ServerState {
  version: 1
  server_id: string
  admin: string
  migrator: string
  app: string
}

type Env = Record<string, string | undefined>

export function composeFile(): string {
  return fileURLToPath(new URL('../../../tooling/inventree-dev/compose.yaml', import.meta.url))
}

export function stateDirectory(env: Env = process.env): string {
  return resolve(env.INTAKE_DEV_STATE ?? join(homedir(), '.local/state/bench-intake'))
}

/** Reads a private owned file, or returns undefined when it does not exist. */
export async function readPrivateFile(path: string, maxBytes = 16384): Promise<string | undefined> {
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return undefined
    }
    throw new Error('private_owned_state_required')
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    stat.size > maxBytes
  ) {
    throw new Error('private_owned_state_required')
  }
  return readFile(path, 'utf8')
}

export function validServerState(value: unknown): value is ServerState {
  const state = value as Record<string, unknown> | null
  return (
    !!state &&
    typeof state === 'object' &&
    state.version === 1 &&
    typeof state.server_id === 'string' &&
    /^[a-f0-9]{32}$/.test(state.server_id) &&
    ['admin', 'migrator', 'app'].every(
      (key) => typeof state[key] === 'string' && /^[a-f0-9]{48}$/.test(state[key] as string),
    )
  )
}

export async function readServerState(env: Env = process.env): Promise<ServerState | undefined> {
  const text = await readPrivateFile(join(stateDirectory(env), SERVER_STATE_FILE))
  if (text === undefined) {
    return undefined
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('invalid_owned_service_state')
  }
  if (!validServerState(value)) {
    throw new Error('invalid_owned_service_state')
  }
  return value
}

export function serverUrl(user: string, password: string, database: string): URL {
  const url = new URL(`postgresql://${PG.host}:${PG.port}/${database}`)
  url.username = user
  url.password = password
  return url
}

/** Superuser access for development provisioning: an explicit admin URL, or the shared server. */
export async function developmentAdmin(env: Env = process.env): Promise<URL> {
  if (env.INTAKE_DEV_ADMIN_URL) {
    return developmentAdminUrl(env.INTAKE_DEV_ADMIN_URL)
  }
  const state = await readServerState(env)
  if (!state) {
    throw new Error('inventree_db_state_missing_run_dev_services')
  }
  return serverUrl('postgres', state.admin, 'postgres')
}

/** Names the database server that app state is bound to. Never derived from a secret. */
export async function serverIdentity(env: Env = process.env): Promise<string> {
  if (env.INTAKE_DEV_ADMIN_URL) {
    const url = developmentAdminUrl(env.INTAKE_DEV_ADMIN_URL)
    return createHash('sha256')
      .update(`admin-url:${url.hostname}:${url.port || '5432'}`)
      .digest('hex')
      .slice(0, 32)
  }
  const state = await readServerState(env)
  if (!state) {
    throw new Error('inventree_db_state_missing_run_dev_services')
  }
  return state.server_id
}

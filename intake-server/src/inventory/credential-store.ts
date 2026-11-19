import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { constants, type Stats } from 'node:fs'
import { realpathSync } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { InventoryCredentialReplace, MAX_INVENTORY_TOKEN_LENGTH } from '@invimport/contracts'
import type { SavedCredential } from './credential.ts'

/** The saved read token with the target it was checked against, alone in its file. */
export const CREDENTIAL_FILE = 'inventory-read-token'

const runFile = promisify(execFile)

/** Group and other permission bits: any of them lets another user near the token. */
const SHARED_PERMISSIONS = 0o077

/** Token, origin, context ID and JSON punctuation fit well inside this, in bytes. */
const MAX_CREDENTIAL_FILE_BYTES = 16 * 1024

const TOKEN_PATTERN = new RegExp(InventoryCredentialReplace.properties.token.pattern!)

/** The InvenTree a saved token was checked against; a token is only ever sent back there. */
export interface CredentialBinding {
  origin: string
  targetContextId: string
}

export type SecretStoreFailure =
  /** No secrets directory is configured, or it can't be written. */
  | 'secret_store_unavailable'
  /** The directory or file is shared with other users, owned by another, or not plain. */
  | 'secret_file_permissions'
  /** The saved file doesn't hold a token and its target. */
  | 'secret_file_invalid'
  /** The secrets directory overlaps a directory the server publishes. */
  | 'invalid_secrets_directory'

export class SecretStoreError extends Error {
  readonly code: SecretStoreFailure

  constructor(code: SecretStoreFailure, options?: ErrorOptions) {
    super(code, options)
    this.code = code
  }
}

/** Post-commit steps a test can make fail. */
export interface StoreEffects {
  /** Flushes the directory entry after a rename or delete. */
  syncDirectory: (directory: string) => Promise<void>
}

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

/** Owner-only, owned by this process's user, and the thing itself rather than a link to it. */
function privateTo(info: Stats) {
  const owner = process.getuid?.()
  const ownedHere = owner === undefined || info.uid === owner
  return ownedHere && (info.mode & SHARED_PERMISSIONS) === 0
}

/** The directory's own entry, never followed; false when it doesn't exist yet. */
async function requirePrivateDirectory(directory: string): Promise<boolean> {
  let info
  try {
    info = await lstat(directory)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false
    }
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
  if (!info.isDirectory() || !privateTo(info) || (await hasAccessList(directory))) {
    throw new SecretStoreError('secret_file_permissions')
  }
  return true
}

/**
 * Whether an access list grants more than the mode bits show. Only macOS needs asking: a Linux
 * POSIX ACL widens the group bits, which `privateTo` already refuses.
 */
async function hasAccessList(path: string) {
  if (process.platform !== 'darwin') {
    return false
  }
  let listing
  try {
    listing = await runFile('/bin/ls', ['-lde', path])
  } catch (error) {
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
  // The first line is the entry itself; each line after it is an access list entry.
  return listing.stdout.trim().split('\n').length > 1
}

/** Resolves links in the part of the path that exists, keeping the rest as written. */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    const parent = dirname(path)
    if (errorCode(error) !== 'ENOENT' || parent === path) {
      throw error
    }
    return join(await canonical(parent), basename(path))
  }
}

function within(inner: string, outer: string) {
  return inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep)
}

/**
 * Refuses a secrets directory inside, or containing, a directory the server publishes, where
 * owner-only modes would not stop the server itself from sending the file.
 */
export async function requireUnpublished(
  directory: string | undefined,
  published: readonly string[],
) {
  if (!directory) {
    return
  }
  const secrets = await canonical(resolve(directory))
  for (const root of published) {
    const served = await canonical(resolve(root))
    if (within(secrets, served) || within(served, secrets)) {
      throw new SecretStoreError('invalid_secrets_directory')
    }
  }
}

/**
 * For a static file handler: false for any request whose file, after following links, is in the
 * secrets directory. A link placed among published files still can't reach the token.
 */
export async function servesOutside(directory: string | undefined) {
  if (!directory) {
    return () => true
  }
  const secrets = await canonical(resolve(directory))
  return (file: string) => {
    let actual
    try {
      actual = realpathSync(file)
    } catch {
      // A file that doesn't exist is answered as not found anyway.
      return true
    }
    return !within(actual, secrets)
  }
}

function parseSaved(text: string, savedAt: string) {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new SecretStoreError('secret_file_invalid', { cause: error })
  }
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const { token, origin, target_context_id: targetContextId } = record
  const wellFormed =
    typeof token === 'string' &&
    token.length <= MAX_INVENTORY_TOKEN_LENGTH &&
    TOKEN_PATTERN.test(token) &&
    typeof origin === 'string' &&
    typeof targetContextId === 'string'
  if (!wellFormed) {
    throw new SecretStoreError('secret_file_invalid')
  }
  return { saved: { token, savedAt }, binding: { origin, targetContextId } }
}

/**
 * Reads the saved token, or null when none is saved or it was checked against another target.
 * A directory or file other users could reach refuses startup rather than being used or
 * repaired. The file is opened without following links or blocking on a pipe.
 */
export async function loadSavedCredential(
  configured: string | undefined,
  binding: CredentialBinding | undefined,
): Promise<SavedCredential | null> {
  const directory = configured && resolve(configured)
  if (!directory || !(await requirePrivateDirectory(directory))) {
    return null
  }
  let file
  try {
    file = await open(
      join(directory, CREDENTIAL_FILE),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null
    }
    throw new SecretStoreError('secret_file_permissions', { cause: error })
  }
  try {
    const info = await file.stat()
    const shared = !info.isFile() || !privateTo(info)
    if (shared || (await hasAccessList(join(directory, CREDENTIAL_FILE)))) {
      throw new SecretStoreError('secret_file_permissions')
    }
    if (info.size > MAX_CREDENTIAL_FILE_BYTES) {
      throw new SecretStoreError('secret_file_invalid')
    }
    const stored = parseSaved(await file.readFile('utf8'), info.mtime.toISOString())
    const sameTarget =
      binding !== undefined &&
      stored.binding.origin === binding.origin &&
      stored.binding.targetContextId === binding.targetContextId
    return sameTarget ? stored.saved : null
  } finally {
    await file.close()
  }
}

/** Flushes a directory entry change, where the platform supports it. */
async function syncDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Replaces the saved token whole: writes an owner-only temporary file, then renames it over the
 * old one. The rename is the commit point. A failure before it leaves the previous file as it
 * was; flushing the directory afterwards is best effort and can't undo it.
 */
export async function saveCredential(
  configured: string | undefined,
  token: string,
  binding: CredentialBinding,
  effects: StoreEffects = { syncDirectory },
): Promise<SavedCredential> {
  const directory = configured && resolve(configured)
  if (!directory) {
    throw new SecretStoreError('secret_store_unavailable')
  }
  const target = join(directory, CREDENTIAL_FILE)
  const temporary = join(directory, `.${CREDENTIAL_FILE}.${randomUUID()}.tmp`)
  const content = JSON.stringify({
    origin: binding.origin,
    target_context_id: binding.targetContextId,
    token,
  })
  let savedAt: string
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await requirePrivateDirectory(directory)
    const file = await open(temporary, 'wx', 0o600)
    try {
      // A new file can inherit an access list from its directory; check before any token byte.
      if (await hasAccessList(temporary)) {
        throw new SecretStoreError('secret_file_permissions')
      }
      await file.writeFile(content, 'utf8')
      await file.sync()
      // A rename keeps the modification time, which later loads report as saved_at.
      savedAt = (await file.stat()).mtime.toISOString()
    } finally {
      await file.close()
    }
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (error instanceof SecretStoreError) {
      throw error
    }
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
  await effects.syncDirectory(directory).catch(() => undefined)
  return { token, savedAt }
}

/**
 * Deletes the saved token; nothing saved is already the wanted outcome. The unlink is the
 * commit point, and the directory flush after it is best effort.
 */
export async function deleteCredential(
  configured: string | undefined,
  effects: StoreEffects = { syncDirectory },
) {
  const directory = configured && resolve(configured)
  if (!directory || !(await requirePrivateDirectory(directory))) {
    return
  }
  try {
    await rm(join(directory, CREDENTIAL_FILE))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return
    }
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
  await effects.syncDirectory(directory).catch(() => undefined)
}

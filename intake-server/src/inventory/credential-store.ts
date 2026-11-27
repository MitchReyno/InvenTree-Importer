import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { constants, type Stats } from 'node:fs'
import { realpathSync, statSync } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
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
  /** Another running server already owns this store. */
  | 'secret_store_in_use'

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
  return (await accessListEntries(path)).length > 0
}

/** The access list entries macOS reports for a path; none elsewhere. */
async function accessListEntries(path: string) {
  if (process.platform !== 'darwin') {
    return []
  }
  let listing
  try {
    listing = await runFile('/bin/ls', ['-lde', path])
  } catch (error) {
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
  // The first line is the entry itself; each line after it is an access list entry.
  return listing.stdout.trim().split('\n').slice(1)
}

/**
 * Whether an access list grants anything. Deny-only entries, such as the `deny delete` macOS
 * puts on home folders, take access away and are fine on an ancestor.
 */
async function accessListGrants(path: string) {
  return (await accessListEntries(path)).some((entry) => /\ballow\b/.test(entry))
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

/** Sticky directories (such as /tmp) let only an entry's owner rename or remove it. */
const STICKY = 0o1000
/** Group and other write bits: either lets another user replace an entry inside. */
const SHARED_WRITE = 0o022

/**
 * Refuses a secrets directory under an ancestor another user could change, where the entry a
 * check inspects and the one a later write uses could differ. Each real ancestor must belong to
 * root or this user, and be unwritable by others unless sticky.
 */
export async function requireStableAncestors(directory: string | undefined) {
  if (!directory) {
    return
  }
  let ancestor = dirname(directory)
  for (;;) {
    // Ancestors that don't exist yet are created later, top-down, each checked as it is made.
    if (await lstat(ancestor).catch(() => undefined)) {
      await requireStableAncestor(ancestor)
    }
    const parent = dirname(ancestor)
    if (parent === ancestor) {
      return
    }
    ancestor = parent
  }
}

/** Links followed while opening the secrets directory before it counts as a loop. */
const MAX_LINKS_FOLLOWED = 32

/**
 * Opens the secrets directory from the root one component at a time, never following anything
 * before it is checked: each directory must pass the ancestor rules before the walk goes into
 * it, each link is checked (with its parent, already checked) before the walk follows it and
 * checks its target the same way, and a missing component is made with an exclusive mkdir and
 * then checked. Returns the directory's real path, which every later operation uses.
 */
export async function openSecretsDir(configured: string | undefined) {
  if (!configured) {
    return undefined
  }
  return walkTrusted(resolve(configured), { followed: 0 }, true)
}

async function walkTrusted(path: string, links: { followed: number }, store: boolean) {
  const parts = path.split(sep).filter(Boolean)
  let current: string = sep
  for (const [index, part] of parts.entries()) {
    const next = join(current, part)
    const last = index === parts.length - 1
    const info = await entryOrCreated(next)
    if (info.isSymbolicLink()) {
      requireTrustedOwner(info)
      links.followed += 1
      if (links.followed > MAX_LINKS_FOLLOWED) {
        throw new SecretStoreError('secret_file_permissions')
      }
      const written = await readlink(next)
      // `..` after a link means the link's parent on disk, not the path's: refused, not guessed.
      if (written.split(/[\\/]/).includes('..')) {
        throw new SecretStoreError('secret_file_permissions')
      }
      const target = resolve(current, written)
      current = await walkTrusted(target, links, store && last)
      continue
    }
    if (!(last && store)) {
      await requireStableAncestor(next)
    }
    current = next
  }
  return current
}

/** The entry at a path, made owner-only by an exclusive mkdir if it was missing. */
async function entryOrCreated(path: string) {
  const found = await lstat(path).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') {
      return undefined
    }
    throw error
  })
  if (found) {
    return found
  }
  await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
    if (errorCode(error) !== 'EEXIST') {
      throw error
    }
  })
  return lstat(path)
}

/** One ancestor: owned by root or this user, unwritable by others unless sticky, no grants. */
async function requireStableAncestor(ancestor: string) {
  const info = await lstat(ancestor)
  if (info.isSymbolicLink()) {
    // A link's own mode means nothing (Linux reports 0777); who owns it and its parent decide.
    requireTrustedOwner(info)
    return
  }
  const othersWrite = (info.mode & SHARED_WRITE) !== 0 && (info.mode & STICKY) === 0
  if (!info.isDirectory() || othersWrite || (await accessListGrants(ancestor))) {
    throw new SecretStoreError('secret_file_permissions')
  }
  requireTrustedOwner(info)
}

/** Owned by root or this process's user; nobody else may own an entry on the way to the store. */
function requireTrustedOwner(info: Stats) {
  const owner = process.getuid?.()
  if (owner !== undefined && info.uid !== 0 && info.uid !== owner) {
    throw new SecretStoreError('secret_file_permissions')
  }
}

/**
 * Creates the secrets directory one component at a time from the top, checking each before
 * going deeper, so no component can be slipped in by another user between a check and the
 * next mkdir. Every created or found ancestor must pass the ancestor rules; the directory
 * itself must be owner-only.
 */
async function createPrivateDirectory(directory: string) {
  const missing: string[] = []
  let existing = directory
  while (!(await lstat(existing).catch(() => undefined))) {
    missing.unshift(existing)
    const parent = dirname(existing)
    if (parent === existing) {
      break
    }
    existing = parent
  }
  for (const component of missing) {
    try {
      await mkdir(component, { mode: 0o700 })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error
      }
    }
    if (component !== directory) {
      await requireStableAncestor(component)
    }
  }
  // Every ancestor again, now all exist: one made by someone else just before the walk counts.
  await requireStableAncestors(directory)
  await requirePrivateDirectory(directory)
}

/** Marks the store as this process's while it runs: a directory holding the owner's PID. */
const LOCK_DIRECTORY = '.inventory-read-token.lock'
const OWNER_FILE = 'pid'
/** Claim attempts before giving up, each after removing one stale lock. */
const MAX_CLAIM_ATTEMPTS = 3

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists but belongs to someone else.
    return errorCode(error) === 'EPERM'
  }
}

/** Who holds the lock: absent, a PID, or unreadable (which is never treated as stale). */
async function lockOwner(lock: string): Promise<'absent' | 'unknown' | number> {
  let text
  try {
    text = await readFile(join(lock, OWNER_FILE), 'utf8')
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      return 'unknown'
    }
    return (await lstat(lock).catch(() => undefined)) ? 'unknown' : 'absent'
  }
  const pid = Number(text.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : 'unknown'
}

/**
 * Removes a lock by first renaming it aside in one step. Deleting it in place would briefly
 * leave an empty directory, which another starter's rename could replace with its own lock.
 */
async function removeLock(directory: string, lock: string) {
  const aside = join(directory, `${LOCK_DIRECTORY}.${randomUUID()}.removed`)
  try {
    await rename(lock, aside)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return
    }
    throw error
  }
  await rm(aside, { recursive: true, force: true })
}

/**
 * Puts a lock carrying this PID in place in one rename, so no other starter ever sees a lock
 * without its owner. False when a lock is already there.
 */
async function placeLock(directory: string, lock: string) {
  const prepared = join(directory, `${LOCK_DIRECTORY}.${randomUUID()}.tmp`)
  await mkdir(prepared, { mode: 0o700 })
  await writeFile(join(prepared, OWNER_FILE), String(process.pid), { mode: 0o600 })
  try {
    await rename(prepared, lock)
    return true
  } catch (error) {
    await rm(prepared, { recursive: true, force: true })
    const code = errorCode(error)
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      return false
    }
    throw error
  }
}

/**
 * Removes a lock whose owner has exited, one starter at a time. The recovery lock is taken with
 * an exclusive mkdir; its holder removes the lock only if it still names the dead owner it saw,
 * so a lock another starter has claimed meanwhile is never touched. A starter that can't take
 * the recovery lock is refused rather than guessing.
 */
async function recoverStale(directory: string, lock: string, deadOwner: number) {
  const recovery = join(directory, `${LOCK_DIRECTORY}.recovery`)
  try {
    await mkdir(recovery, { mode: 0o700 })
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error
    }
    // Never expired: a recovery left by a crash stays until it is removed with no server running.
    throw new SecretStoreError('secret_store_in_use')
  }
  try {
    if ((await lockOwner(lock)) === deadOwner) {
      await removeLock(directory, lock)
    }
  } finally {
    await rm(recovery, { recursive: true, force: true })
  }
}

/**
 * Claims the store for this process's lifetime, so two servers never keep different tokens in
 * memory over one file. A lock whose owner has exited is removed under a recovery lock, one starter
 * at a time, then claimed afresh. The release runs once and removes only this process's
 * lock.
 */
export async function claimStore(directory: string | undefined): Promise<() => Promise<void>> {
  if (!directory) {
    return async () => undefined
  }
  await createPrivateDirectory(directory)
  const lock = join(directory, LOCK_DIRECTORY)
  try {
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      if (await placeLock(directory, lock)) {
        let released = false
        return async () => {
          if (released) {
            return
          }
          released = true
          if ((await lockOwner(lock)) === process.pid) {
            await removeLock(directory, lock)
          }
        }
      }
      const owner = await lockOwner(lock)
      if (owner === 'absent') {
        // Released meanwhile: try the atomic claim again rather than recovering anything.
        continue
      }
      if (owner === 'unknown' || processAlive(owner)) {
        throw new SecretStoreError('secret_store_in_use')
      }
      await recoverStale(directory, lock, owner)
    }
  } catch (error) {
    if (error instanceof SecretStoreError) {
      throw error
    }
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
  throw new SecretStoreError('secret_store_in_use')
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
    // Spellings first, then identities: one directory can have two real paths (macOS volumes).
    const overlapping =
      within(secrets, served) ||
      within(served, secrets) ||
      containsIdentity(secrets, served) ||
      containsIdentity(served, secrets)
    if (overlapping) {
      throw new SecretStoreError('invalid_secrets_directory')
    }
  }
}

/** A directory's identity, which no spelling of its path can change. */
function identity(info: Stats) {
  return `${info.dev}:${info.ino}`
}

/** The identities of a path and every ancestor that exists, after following links. */
function chainIdentities(path: string) {
  const found = new Set<string>()
  let current = path
  for (;;) {
    try {
      found.add(identity(statSync(current)))
    } catch {
      // A part not yet created has no identity; its ancestors still do.
    }
    const parent = dirname(current)
    if (parent === current) {
      return found
    }
    current = parent
  }
}

/** Whether `inner` is `outer` or below it, judged by directory identity. */
function containsIdentity(inner: string, outer: string) {
  let outerInfo
  try {
    outerInfo = statSync(outer)
  } catch {
    return false
  }
  return chainIdentities(inner).has(identity(outerInfo))
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
    return !within(actual, secrets) && !containsIdentity(actual, secrets)
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
    await createPrivateDirectory(directory)
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

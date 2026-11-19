import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { InventoryCredentialReplace, MAX_INVENTORY_TOKEN_LENGTH } from '@invimport/contracts'
import type { SavedCredential } from './credential.ts'

/** The saved read token, alone in its file. */
export const CREDENTIAL_FILE = 'inventory-read-token'

/** Group and other permission bits: any of them lets another user near the token. */
const SHARED_PERMISSIONS = 0o077

const TOKEN_PATTERN = new RegExp(InventoryCredentialReplace.properties.token.pattern!)

export type SecretStoreFailure =
  /** No secrets directory is configured, or it can't be written. */
  | 'secret_store_unavailable'
  /** The saved file or its directory can be read by other users, or isn't a plain file. */
  | 'secret_file_permissions'
  /** The saved file doesn't hold a token. */
  | 'secret_file_invalid'

export class SecretStoreError extends Error {
  readonly code: SecretStoreFailure

  constructor(code: SecretStoreFailure, options?: ErrorOptions) {
    super(code, options)
    this.code = code
  }
}

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function requirePrivateDirectory(directory: string) {
  const info = await stat(directory)
  if (!info.isDirectory() || (info.mode & SHARED_PERMISSIONS) !== 0) {
    throw new SecretStoreError('secret_file_permissions')
  }
}

/**
 * Reads the saved token, or null when none is saved. A file other users could read refuses
 * startup rather than being used or repaired.
 */
export async function loadSavedCredential(
  directory: string | undefined,
): Promise<SavedCredential | null> {
  if (!directory) {
    return null
  }
  let file
  try {
    file = await open(join(directory, CREDENTIAL_FILE), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (missing(error)) {
      return null
    }
    throw new SecretStoreError('secret_file_permissions', { cause: error })
  }
  try {
    const info = await file.stat()
    if (!info.isFile() || (info.mode & SHARED_PERMISSIONS) !== 0) {
      throw new SecretStoreError('secret_file_permissions')
    }
    await requirePrivateDirectory(directory)
    if (info.size > MAX_INVENTORY_TOKEN_LENGTH) {
      throw new SecretStoreError('secret_file_invalid')
    }
    const token = await file.readFile('utf8')
    if (!TOKEN_PATTERN.test(token) || token.length > MAX_INVENTORY_TOKEN_LENGTH) {
      throw new SecretStoreError('secret_file_invalid')
    }
    return { token, savedAt: info.mtime.toISOString() }
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
 * old one, so a failure leaves the previous file as it was.
 */
export async function saveCredential(
  directory: string | undefined,
  token: string,
): Promise<SavedCredential> {
  if (!directory) {
    throw new SecretStoreError('secret_store_unavailable')
  }
  const target = join(directory, CREDENTIAL_FILE)
  const temporary = join(directory, `.${CREDENTIAL_FILE}.${randomUUID()}.tmp`)
  let savedAt: string
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await requirePrivateDirectory(directory)
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(token, 'utf8')
      await file.sync()
      // A rename keeps the modification time, which later loads report as saved_at.
      savedAt = (await file.stat()).mtime.toISOString()
    } finally {
      await file.close()
    }
    await rename(temporary, target)
    await syncDirectory(directory)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (error instanceof SecretStoreError) {
      throw error
    }
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
  return { token, savedAt }
}

/** Deletes the saved token; nothing saved is already the wanted outcome. */
export async function deleteCredential(directory: string | undefined) {
  if (!directory) {
    return
  }
  try {
    await rm(join(directory, CREDENTIAL_FILE))
    await syncDirectory(directory)
  } catch (error) {
    if (missing(error)) {
      return
    }
    throw new SecretStoreError('secret_store_unavailable', { cause: error })
  }
}

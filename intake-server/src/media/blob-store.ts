import { MEDIA_SOURCE_MAX_BYTES } from '@invimport/contracts/media'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { PoolClient } from 'pg'

export const MAX_UPLOAD_BYTES = MEDIA_SOURCE_MAX_BYTES
const MIN_GC_AGE_MS = 24 * 60 * 60 * 1000
const DIGEST = /^[a-f0-9]{64}$/

export interface RetainedBlob {
  digest: string
  size: string
}

function checkedDigest(digest: string) {
  if (!DIGEST.test(digest)) {
    throw new Error('invalid_blob_digest')
  }
  return digest
}

function digestLockKey(digest: string) {
  return createHash('sha256')
    .update(`bench-intake-blob/1:${checkedDigest(digest)}`)
    .digest()
    .readBigInt64BE()
}

/** PostgreSQL exposes a bigint advisory key as two unsigned OID coordinates. */
export function blobLockCoordinates(digest: string) {
  const key = BigInt.asUintN(64, digestLockKey(digest))
  return {
    classId: (key >> 32n).toString(),
    objectId: (key & 0xffffffffn).toString(),
  }
}

/** Publication and GC retain this transaction lock through their DB decision. */
export async function lockBlob(client: PoolClient, digest: string) {
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [digestLockKey(digest).toString()])
}

async function syncDirectory(path: string) {
  const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error
    }
  })
  const stat = await lstat(path)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new Error('unsafe_blob_directory')
  }
}

/** Private local immutable bytes. Paths never leave this module or become public IDs. */
export class BlobStore {
  private constructor(private readonly root: string) {}

  static async initialize(configuredRoot: string) {
    const root = resolve(configuredRoot)
    await privateDirectory(root)
    if ((await realpath(root)) !== root) {
      throw new Error('symlink_blob_root')
    }
    await privateDirectory(join(root, 'staging'))
    await privateDirectory(join(root, 'objects'))
    await syncDirectory(root)
    return new BlobStore(root)
  }

  private async directory(digest: string) {
    const directory = join(this.root, 'objects', checkedDigest(digest).slice(0, 2))
    await privateDirectory(directory)
    await syncDirectory(join(this.root, 'objects'))
    return directory
  }

  /** Caller commits its receipt while retaining the digest lock acquired here. */
  async publish(client: PoolClient, bytes: Buffer): Promise<RetainedBlob> {
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error('upload_byte_limit')
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    await lockBlob(client, digest)
    const directory = await this.directory(digest)
    const destination = join(directory, digest)
    const staging = join(this.root, 'staging', randomUUID())
    try {
      const file = await open(staging, 'wx', 0o600)
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
      await link(staging, destination).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') {
          throw error
        }
        // Deduplication adopts only exact existing durable bytes, never a path match.
        const existing = await this.read(digest)
        if (!existing.equals(bytes)) {
          throw new Error('blob_collision_or_corruption')
        }
      })
      await syncDirectory(directory)
    } finally {
      await unlink(staging).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error
        }
      })
      await syncDirectory(join(this.root, 'staging'))
    }
    return { digest, size: String(bytes.length) }
  }

  async read(digest: string): Promise<Buffer> {
    checkedDigest(digest)
    const directory = join(this.root, 'objects', digest.slice(0, 2))
    const stat = await lstat(directory)
    const wrongOwner = typeof process.getuid === 'function' && stat.uid !== process.getuid()
    if (wrongOwner || !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error('unsafe_blob_directory')
    }
    const file = await open(join(directory, digest), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await file.stat()
      if (
        !metadata.isFile() ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
        (metadata.mode & 0o077) !== 0 ||
        metadata.size <= 0 ||
        metadata.size > MAX_UPLOAD_BYTES
      ) {
        throw new Error('unsafe_blob_file')
      }
      const bytes = await file.readFile()
      if (createHash('sha256').update(bytes).digest('hex') !== digest) {
        throw new Error('blob_corrupt')
      }
      return bytes
    } finally {
      await file.close()
    }
  }

  /** Explicit maintenance only. Positive reference/pin query belongs to media repository. */
  async collect(
    client: PoolClient,
    digest: string,
    olderThan: Date,
    referenced: (client: PoolClient, digest: string) => Promise<boolean>,
  ): Promise<boolean> {
    checkedDigest(digest)
    if (!Number.isFinite(olderThan.getTime()) || olderThan.getTime() > Date.now() - MIN_GC_AGE_MS) {
      throw new Error('unsafe_gc_age')
    }
    await lockBlob(client, digest)
    if (await referenced(client, digest)) {
      return false
    }
    const directory = await this.directory(digest)
    const path = join(directory, digest)
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (!stat) {
      return false
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('unsafe_blob_file')
    }
    if (stat.mtimeMs >= olderThan.getTime()) {
      return false
    }
    await unlink(path)
    await syncDirectory(directory)
    return true
  }
}

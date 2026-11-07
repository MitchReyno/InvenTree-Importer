import { Id, Digest } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { MAX_BLOB_BYTES } from '../media/blob-store.ts'

export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024
export const MAX_ARCHIVE_BLOBS = 10000
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
export interface ArchiveManifest {
  format: 'bench-intake-archive/1'
  database_sha256: string
  external_binding_sha256: string
  store_id: string
  blobs: { digest: string; size: string }[]
  migrations: { name: string; sha256: string }[]
  scheduler: 'same-database'
  credentials: 'excluded'
  activation: 'externally-disabled'
}

/** A manifest is untrusted input; paths are derived only from validated digest names. */
export function archiveManifest(value: unknown): ArchiveManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_archive')
  }
  const row = value as Record<string, unknown>
  const keys = [
    'format',
    'database_sha256',
    'external_binding_sha256',
    'store_id',
    'blobs',
    'migrations',
    'scheduler',
    'credentials',
    'activation',
  ]
  if (
    Object.keys(row).sort().join(',') !== keys.sort().join(',') ||
    row.format !== 'bench-intake-archive/1' ||
    row.scheduler !== 'same-database' ||
    row.credentials !== 'excluded' ||
    row.activation !== 'externally-disabled' ||
    typeof row.external_binding_sha256 !== 'string' ||
    !new RegExp(Digest.pattern!).test(row.external_binding_sha256) ||
    typeof row.database_sha256 !== 'string' ||
    !new RegExp(Digest.pattern!).test(row.database_sha256) ||
    typeof row.store_id !== 'string' ||
    !new RegExp(Id.pattern!).test(row.store_id) ||
    !Array.isArray(row.blobs) ||
    row.blobs.length > MAX_ARCHIVE_BLOBS ||
    !Array.isArray(row.migrations) ||
    row.migrations.length > 1000
  ) {
    throw new Error('invalid_archive')
  }
  let size = 0n
  for (const blob of row.blobs) {
    if (
      !blob ||
      typeof blob !== 'object' ||
      Object.keys(blob).sort().join(',') !== 'digest,size' ||
      typeof blob.digest !== 'string' ||
      !new RegExp(Digest.pattern!).test(blob.digest) ||
      typeof blob.size !== 'string' ||
      !/^[1-9][0-9]{0,10}$/.test(blob.size)
    ) {
      throw new Error('invalid_archive')
    }
    if (BigInt(blob.size) > BigInt(MAX_BLOB_BYTES)) {
      throw new Error('archive_blob_limit')
    }
    size += BigInt(blob.size)
  }
  if (
    size > BigInt(MAX_ARCHIVE_BYTES) ||
    new Set(row.blobs.map((blob) => blob.digest)).size !== row.blobs.length
  ) {
    throw new Error('archive_limit')
  }
  for (const migration of row.migrations) {
    if (
      !migration ||
      typeof migration !== 'object' ||
      Object.keys(migration).sort().join(',') !== 'name,sha256' ||
      typeof migration.name !== 'string' ||
      !/^\d{4}_[a-z_]+\.sql$/.test(migration.name) ||
      typeof migration.sha256 !== 'string' ||
      !new RegExp(Digest.pattern!).test(migration.sha256)
    ) {
      throw new Error('invalid_archive')
    }
  }
  return row as unknown as ArchiveManifest
}

export function decodeArchiveManifest(bytes: Uint8Array): ArchiveManifest {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return archiveManifest(strictJson(text, MAX_MANIFEST_BYTES))
}

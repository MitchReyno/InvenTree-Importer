import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, chmod, readFile, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PoolClient } from 'pg'
import { BlobStore, MAX_UPLOAD_BYTES } from '../src/media/blob-store.ts'

// This records the transaction-lock request only; PostgreSQL exclusion has a separate PG test.
const locks: string[] = []
const client = {
  query: async (_sql: string, values: string[]) => {
    locks.push(values[0])
    return { rows: [] }
  },
} as unknown as PoolClient

async function fixture(work: (root: string, store: BlobStore) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-file-')))
  try {
    const store = await BlobStore.initialize(root)
    await work(root, store)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('literal bytes are private, hash checked and deduplicated without rewriting', async () => {
  await fixture(async (root, store) => {
    const bytes = Buffer.from('abc')
    const first = await store.publish(client, bytes)
    assert.deepEqual(first, {
      digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      size: '3',
    })
    assert.deepEqual(await store.read(first.digest), bytes)
    const second = await store.publish(client, bytes)
    assert.deepEqual(second, first)
    assert.equal(locks.at(-1), locks.at(-2))
    const path = join(root, 'objects', 'ba', first.digest)
    await writeFile(path, 'abd')
    await assert.rejects(store.read(first.digest), /blob_corrupt/)
    await assert.rejects(store.publish(client, bytes), /blob_corrupt/)
    assert.equal((await readFile(path)).toString(), 'abd')
  })
})

test('traversal, symlinks, public directories and byte bombs fail closed', async () => {
  await fixture(async (root, store) => {
    await assert.rejects(store.read('../escape'), /invalid_blob_digest/)
    await assert.rejects(store.publish(client, Buffer.alloc(0)), /upload_byte_limit/)
    await assert.rejects(
      store.publish(client, Buffer.alloc(MAX_UPLOAD_BYTES + 1)),
      /upload_byte_limit/,
    )
    const directory = join(root, 'objects', 'ab')
    await mkdir(directory, { mode: 0o700 })
    await symlink(join(root, 'outside'), join(directory, 'ab'.repeat(32)))
    await assert.rejects(store.read('ab'.repeat(32)))
    await chmod(directory, 0o755)
    await assert.rejects(store.read('ab'.repeat(32)), /unsafe_blob_directory/)
  })
})

test('explicit collection retains references and refuses recent cutoff', async () => {
  await fixture(async (_root, store) => {
    const blob = await store.publish(client, Buffer.from('retained'))
    await assert.rejects(
      store.collect(client, blob.digest, new Date(), async () => false),
      /unsafe_gc_age/,
    )
    assert.equal(
      await store.collect(client, blob.digest, new Date(Date.now() - 172800000), async () => true),
      false,
    )
    assert.equal((await store.read(blob.digest)).toString(), 'retained')
  })
})

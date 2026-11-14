import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const MARKER_NAME = '.media-store.json'
const STORE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function verifyMarker(path: string, expected: Buffer) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (
      !metadata.isFile() ||
      metadata.mode & 0o077 ||
      (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
      metadata.size !== expected.length
    ) {
      throw new Error('unsafe_media_store_marker')
    }
    const buffer = Buffer.alloc(expected.length + 1)
    const { bytesRead } = await file.read({ buffer, position: 0, length: buffer.length })
    if (bytesRead !== expected.length || !buffer.subarray(0, bytesRead).equals(expected)) {
      throw new Error('media_store_identity_mismatch')
    }
    // A concurrent initializer cannot adopt bytes before their durability checkpoint.
    await file.sync()
  } finally {
    await file.close()
  }
}

/** No rebind or unmarked-data adoption. A copied UUID remains the same restored authority. */
export async function bindMediaStore(root: string, storeId: string) {
  if (storeId.length !== 36 || !STORE_ID.test(storeId)) {
    throw new Error('invalid_media_store_identity')
  }
  const expected = Buffer.from(
    JSON.stringify({ version: 'media-store/1', store_id: storeId }) + '\n',
  )
  const marker = join(root, MARKER_NAME)
  const entries = await readdir(root)
  if (entries.includes(MARKER_NAME)) {
    await verifyMarker(marker, expected)
    return
  }
  if (entries.length) {
    throw new Error('unbound_nonempty_media_store')
  }
  let file
  try {
    file = await open(marker, 'wx', 0o600)
  } catch (failure) {
    if (!(failure instanceof Error) || !('code' in failure) || failure.code !== 'EEXIST') {
      throw failure
    }
    await verifyMarker(marker, expected)
    return
  }
  try {
    await file.writeFile(expected)
    await file.sync()
  } finally {
    await file.close()
  }
}

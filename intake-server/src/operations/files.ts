import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export async function privateFile(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077 ||
      stat.size > maxBytes
    ) {
      throw new Error('private_operational_file_required')
    }
    const bytes = await file.readFile()
    if (bytes.length > maxBytes) {
      throw new Error('operational_file_limit')
    }
    return bytes
  } finally {
    await file.close()
  }
}

export async function privateDirectory(path: string) {
  const resolved = resolve(path)
  const stat = await lstat(resolved)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    (await realpath(resolved)) !== resolved
  ) {
    throw new Error('private_operational_directory_required')
  }
  return resolved
}

export async function newDirectory(path: string) {
  const resolved = resolve(path)
  if ((await realpath(dirname(resolved))) !== dirname(resolved)) {
    throw new Error('symlink_operational_parent')
  }
  await mkdir(resolved, { mode: 0o700 })
  const parent = await open(dirname(resolved), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
  return privateDirectory(resolved)
}

export async function writeExclusive(path: string, bytes: Buffer | string) {
  const file = await open(path, 'wx', 0o600)
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

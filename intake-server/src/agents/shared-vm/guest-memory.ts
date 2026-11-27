import { readFile } from 'node:fs/promises'

/**
 * The VM's total memory in bytes from `/proc/meminfo` text, or undefined when it has no readable
 * `MemTotal`. A container sees the kernel's total, not its own memory limit.
 */
export function memTotalBytes(meminfo: string) {
  const match = /^MemTotal:\s+(\d{1,12}) kB$/m.exec(meminfo)
  if (!match) {
    return undefined
  }
  return Number(match[1]) * 1024
}

/** The VM's total memory as the guest reads it, or undefined when it can't be read. */
export async function guestMemoryBytes(path = '/proc/meminfo') {
  const meminfo = await readFile(path, 'utf8').catch(() => undefined)
  return meminfo === undefined ? undefined : memTotalBytes(meminfo)
}

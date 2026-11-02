import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Id } from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { privateDirectory, privateFile } from './files.ts'

/** Inspection cannot enable activation, reap a claim, or erase an independent remote witness. */
export async function requireDisabledGate(root: string) {
  await privateDirectory(root)
  const raw = strictJson((await privateFile(join(root, 'activation.json'), 16384)).toString('utf8'))
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    !('enabled' in raw) ||
    raw.enabled !== false
  ) {
    throw new Error('externally_disabled_apply_required')
  }
  const activation = raw as Record<string, unknown>
  for (const field of ['deploymentId', 'epoch', 'targetId', 'contextId']) {
    const value = activation[field]
    if (typeof value !== 'string' || !new RegExp(Id.pattern!).test(value)) {
      throw new Error('invalid_external_activation')
    }
  }
  for (const field of ['origin', 'continuity', 'build', 'capability']) {
    const value = activation[field]
    if (typeof value !== 'string' || !value.trim() || value.length > 256) {
      throw new Error('invalid_external_activation')
    }
  }
  const claim = await lstat(join(root, 'writer')).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return null
  })
  if (claim) {
    throw new Error('physical_writer_not_reaped')
  }
  await privateDirectory(join(root, 'witnesses'))
  const witnesses = await readdir(join(root, 'witnesses'))
  if (witnesses.some((name) => !/^[a-f0-9-]{36}\.json$/.test(name))) {
    throw new Error('external_witness_corrupt')
  }
  const identity = Object.fromEntries(
    [
      'deploymentId',
      'epoch',
      'targetId',
      'contextId',
      'origin',
      'continuity',
      'build',
      'capability',
    ].map((field) => [field, activation[field]]),
  )
  return {
    activation: raw,
    witnesses: witnesses.sort(),
    bindingSha256: createHash('sha256').update(canonical(identity)).digest('hex'),
  }
}

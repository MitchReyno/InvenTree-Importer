import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A dedicated installation CA signs exactly one worker and one guest identity. */
export async function pairing(directory: string) {
  const [ca, cert, key] = await Promise.all(
    ['ca.pem', 'cert.pem', 'key.pem'].map((name) => readFile(join(directory, name))),
  )
  return { ca, cert, key, minVersion: 'TLSv1.3' as const, rejectUnauthorized: true }
}

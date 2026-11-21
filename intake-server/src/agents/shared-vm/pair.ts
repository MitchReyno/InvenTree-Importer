import { readFile } from 'node:fs/promises'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { join } from 'node:path'

/**
 * A dedicated installation CA signs exactly one worker and one guest identity. The files are
 * checked before use: TLS accepts arbitrary text as a CA, so a corrupt pairing would otherwise
 * start a listener that can never authenticate its peer.
 */
export async function pairing(directory: string) {
  const [ca, cert, key] = await Promise.all(
    ['ca.pem', 'cert.pem', 'key.pem'].map((name) => readFile(join(directory, name))),
  )
  checkPairing(ca, cert, key)
  return { ca, cert, key, minVersion: 'TLSv1.3' as const, rejectUnauthorized: true }
}

function checkPairing(ca: Buffer, cert: Buffer, key: Buffer) {
  let paired = false
  try {
    const authority = new X509Certificate(ca)
    const identity = new X509Certificate(cert)
    paired =
      identity.checkIssued(authority) &&
      identity.verify(authority.publicKey) &&
      identity.checkPrivateKey(createPrivateKey(key))
  } catch {
    paired = false
  }
  if (!paired) {
    throw new Error('invalid_pairing')
  }
}

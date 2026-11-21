import { execFileSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A throwaway pairing under `root`: `bench-coordinator/` and `bench-guest/`, each with its key,
 * certificate and the shared CA, valid for one day.
 */
export async function pairedCertificates(root: string) {
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: root, stdio: 'ignore' })
  ssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=Test CA',
    '-days',
    '1',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
  )
  for (const name of ['bench-coordinator', 'bench-guest']) {
    await mkdir(join(root, name))
    ssl(
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=' + name,
      '-keyout',
      name + '/key.pem',
      '-out',
      name + '.csr',
    )
    ssl(
      'x509',
      '-req',
      '-in',
      name + '.csr',
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-days',
      '1',
      '-out',
      name + '/cert.pem',
    )
    await copyFile(join(root, 'ca.pem'), join(root, name, 'ca.pem'))
  }
}

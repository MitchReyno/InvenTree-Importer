const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { cp, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { guestCertificateValid, hostPairingValid } = require('../dev/vm-provision.cjs')

const openssl = (cwd, ...args) => execFileSync('openssl', args, { cwd, stdio: 'ignore' })

/** A pairing made the way `pair.sh` makes one: a CA, then a host and a guest certificate. */
async function pairing(root, name) {
  const dir = join(root, name)
  await mkdir(join(dir, 'host'), { recursive: true })
  await mkdir(join(dir, 'guest'), { recursive: true })
  openssl(
    dir,
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=Bench Intake pairing CA',
    '-days',
    '1',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
  )
  for (const [role, peer] of [
    ['host', 'bench-coordinator'],
    ['guest', 'bench-guest'],
  ]) {
    openssl(
      dir,
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      `/CN=${peer}`,
      '-keyout',
      `${role}/key.pem`,
      '-out',
      `${role}.csr`,
    )
    await writeFile(join(dir, 'ext'), `subjectAltName=DNS:${peer}\n`)
    openssl(
      dir,
      'x509',
      '-req',
      '-in',
      `${role}.csr`,
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-days',
      '1',
      '-extfile',
      'ext',
      '-out',
      `${role}/cert.pem`,
    )
    await cp(join(dir, 'ca.pem'), join(dir, role, 'ca.pem'))
  }
  return dir
}

test('each side of a pairing is checked for its CA, its key and the peer it names', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'vm-pairing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const made = await pairing(root, 'made')
  const other = await pairing(root, 'other')
  const host = (pair) => hostPairingValid({ plan: { pair } })

  assert.equal(await host(join(made, 'host')), true)
  // The guest's certificate and key in the host directory: same CA, wrong peer.
  assert.equal(await host(join(made, 'guest')), false)
  // A key from another pairing.
  const mixed = join(root, 'mixed')
  await cp(join(made, 'host'), mixed, { recursive: true })
  await cp(join(other, 'host', 'key.pem'), join(mixed, 'key.pem'))
  assert.equal(await host(mixed), false)

  const ca = join(made, 'host', 'ca.pem')
  const certificate = async (dir, role) => readFile(join(dir, role, 'cert.pem'), 'utf8')
  assert.equal(await guestCertificateValid(ca, await certificate(made, 'guest')), true)
  // The host's certificate where the guest's should be: same CA, wrong peer.
  assert.equal(await guestCertificateValid(ca, await certificate(made, 'host')), false)
  assert.equal(await guestCertificateValid(ca, await certificate(other, 'guest')), false)
})

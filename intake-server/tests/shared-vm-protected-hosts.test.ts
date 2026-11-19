import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, open, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProcessingInputV6Dto } from '@invimport/contracts'
import {
  bridgeProtectedHosts,
  MAX_PROTECTED_HOSTS,
  protectedHosts,
} from '#/agents/shared-vm/protected-hosts.ts'
import {
  MAX_TURN_POLICY_BYTES,
  turnPolicy,
  writeTurnPolicy,
} from '#/agents/shared-vm/turn-policy.ts'

test('protected hosts come from every configured origin in a standard form, without non-public literals', () => {
  assert.deepEqual(
    protectedHosts(
      [
        'http://127.0.0.1:4330',
        'https://Bench.Tailnet.TS.net',
        'https://inventory.example.com.',
        'https://inventory.internal:8443',
        'https://[2606:4700::1]',
        'https://203.0.113.10',
        'https://bücher.example',
        'https://[::ffff:1.1.1.1]',
      ].join(','),
    ),
    [
      '2606:4700::1',
      '::ffff:101:101',
      'bench.tailnet.ts.net',
      'inventory.example.com',
      'inventory.internal',
      'xn--bcher-kva.example',
    ],
  )
})

test('bare localhost is dropped; dotted localhost names are kept for the guest to classify', () => {
  assert.deepEqual(protectedHosts('http://localhost:8000,http://inventree.localhost'), [
    'inventree.localhost',
  ])
})

test('an origin that cannot be represented is refused, never dropped', () => {
  for (const origins of [
    '',
    ' , ',
    'not a url',
    'ftp://inventory.example.com',
    'https://inventree',
    'https://inventory_example.com',
    'https:inventory.example.com',
    'https://user:secret@inventory.example.com',
    'https://inventory.example.com/api',
    'https://inventory.example.com/?q=1',
    'https://inventory.example.com?',
    'https://inventory.example.com#top',
    'https://\\inventory.example.com',
    'https://inventory.\texample.com',
    'https://inventory.example.com,,',
    ',https://inventory.example.com',
    'https://',
    `https://${['a'.repeat(63), 'a'.repeat(63), 'a'.repeat(63), 'a'.repeat(63)].join('.')}`,
  ]) {
    assert.throws(
      () => protectedHosts(origins),
      /session_agent_configuration_required/,
      String(origins),
    )
  }
})

test('more than 32 distinct protected hosts are refused', () => {
  const origins = Array.from({ length: 33 }, (_value, index) => `https://h${index}.example.com`)
  assert.throws(() => protectedHosts(origins.join(',')), /session_agent_configuration_required/)
})

test('non-public literals do not use the protected-host budget', () => {
  const publicNames = Array.from(
    { length: MAX_PROTECTED_HOSTS },
    (_value, index) => `https://h${index}.example.com`,
  )
  const origins = [
    ...publicNames,
    'http://127.0.0.1:4330',
    'http://10.0.0.5',
    'https://[fd00::1]',
    'https://[::ffff:7f00:1]',
  ]
  assert.equal(protectedHosts(origins.join(',')).length, MAX_PROTECTED_HOSTS)
})

test('the VM tool worker requires its protected origins; other profiles ignore them', () => {
  assert.throws(
    () => bridgeProtectedHosts({}, 'shared-vm-agent/2'),
    /session_agent_configuration_required/,
  )
  assert.throws(
    () =>
      bridgeProtectedHosts(
        { INTAKE_AGENT_PROTECTED_ORIGINS: 'https://inventree' },
        'shared-vm-agent/2',
      ),
    /session_agent_configuration_required/,
  )
  assert.deepEqual(
    bridgeProtectedHosts(
      { INTAKE_AGENT_PROTECTED_ORIGINS: 'http://127.0.0.1:4330,https://inventory.example.com' },
      'shared-vm-agent/2',
    ),
    ['inventory.example.com'],
  )
  assert.deepEqual(bridgeProtectedHosts({}, 'shared-vm-agent/1'), [])
  assert.deepEqual(bridgeProtectedHosts({}, 'synthetic-session/1'), [])
})

function manifest(web?: { public_pages: boolean; prefer_datasheets: boolean }) {
  return { profile_id: 'shared-vm-agent/2', ...(web ? { web } : {}) } as ProcessingInputV6Dto
}

test('no current profile opens public pages, whatever its sealed setting says', () => {
  const hosts = ['inventory.example.com', '203.0.113.10']
  assert.deepEqual(turnPolicy(manifest(), hosts), {
    version: 1,
    public_pages: false,
    protected_hosts: hosts,
  })
  for (const web of [
    { public_pages: true, prefer_datasheets: false },
    { public_pages: false, prefer_datasheets: true },
  ]) {
    assert.equal(turnPolicy(manifest(web), hosts).public_pages, false, JSON.stringify(web))
  }
})

test('the largest valid policy fits the size the egress proxy reads', () => {
  const hosts = Array.from({ length: MAX_PROTECTED_HOSTS }, (_value, index) =>
    [
      `${String(index).padStart(2, '0')}${'a'.repeat(61)}`,
      'a'.repeat(63),
      'a'.repeat(63),
      'b'.repeat(61),
    ].join('.'),
  )
  assert.ok(hosts.every((host) => host.length === 253))
  const policy = turnPolicy(manifest(), hosts)
  assert.ok(Buffer.byteLength(JSON.stringify(policy)) <= MAX_TURN_POLICY_BYTES)
})

test('a command whose protected hosts are missing or malformed is refused', () => {
  for (const value of [
    undefined,
    'inventory.example.com',
    ['Inventory.Example.com'],
    ['inventree'],
    [42],
    Array.from({ length: 33 }, (_value, index) => `h${index}.example.com`),
  ]) {
    assert.throws(() => turnPolicy(manifest(), value), /invalid_turn/, JSON.stringify(value))
  }
})

test('the policy file is replaced atomically and leaves no temporary file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'turn-policy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'policy.json')
  await writeTurnPolicy(path, turnPolicy(manifest(), ['inventory.example.com']))
  // A reader that opened the old policy keeps reading it whole; an in-place rewrite would not.
  const earlier = await open(path)
  t.after(() => earlier.close())
  await writeTurnPolicy(path, turnPolicy(manifest(), ['203.0.113.10']))
  assert.deepEqual(JSON.parse(await earlier.readFile('utf8')), {
    version: 1,
    public_pages: false,
    protected_hosts: ['inventory.example.com'],
  })
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    version: 1,
    public_pages: false,
    protected_hosts: ['203.0.113.10'],
  })
  assert.deepEqual(await readdir(directory), ['policy.json'])
})

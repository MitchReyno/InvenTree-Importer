import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pinSourceDestination, publicSourceAddress } from '#/research/source-policy.ts'
import { requestPinnedSource, sourceFetcher } from '#/research/source-fetch.ts'
import { MAX_RESEARCH_SOURCE_BYTES } from '#/research/limits.ts'

const sourceUrl = 'https://manufacturer.example/datasheet.pdf'
const policy = {
  approvedUrls: [sourceUrl],
  protectedOrigins: ['https://inventory.example'],
}

const publicResolver = async (hostname: string) => [
  { address: hostname === 'inventory.example' ? '8.8.4.4' : '8.8.8.8', family: 4 as const },
]

test('source policy rejects private, mapped, reserved and malformed destinations', () => {
  const refused = [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '172.16.2.3',
    '192.168.1.10',
    '100.100.100.100',
    '192.0.2.1',
    '198.18.0.1',
    '224.1.2.3',
    '0.0.0.0',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.1.1',
    '127.1',
    '2130706433',
    'fe80::1%lo0',
  ]
  for (const address of refused) {
    assert.throws(() => publicSourceAddress(address), /research_source_refused/, address)
  }
  assert.deepEqual(publicSourceAddress('::ffff:8.8.8.8'), { address: '8.8.8.8', family: 4 })
  assert.deepEqual(publicSourceAddress('2606:4700:4700::1111'), {
    address: '2606:4700:4700::1111',
    family: 6,
  })
})

test('exact source admission refuses encoded exfiltration, credentials and alternate ports before DNS', async () => {
  let resolutions = 0
  const resolve = async () => {
    resolutions += 1
    return [{ address: '8.8.8.8', family: 4 as const }]
  }
  const refused = [
    `${sourceUrl}?private=human-note`,
    'https://manufacturer.example/private-human-note',
    'https://other.example/datasheet.pdf',
    'https://user:secret@manufacturer.example/datasheet.pdf',
    `${sourceUrl}#private`,
    'https://manufacturer.example:444/datasheet.pdf',
    'file:///etc/passwd',
  ]
  for (const url of refused) {
    await assert.rejects(
      pinSourceDestination(url, policy, new AbortController().signal, resolve),
      /research_source_refused/,
    )
  }
  assert.equal(resolutions, 0)
})

test('source policy rejects mixed DNS answers and protected aliases and pins one public result', async () => {
  await assert.rejects(
    pinSourceDestination(sourceUrl, policy, new AbortController().signal, async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    /research_source_refused/,
  )
  await assert.rejects(
    pinSourceDestination(sourceUrl, policy, new AbortController().signal, async () => [
      { address: '8.8.8.8', family: 4 },
    ]),
    /research_source_refused/,
  )
  const pinned = await pinSourceDestination(
    sourceUrl,
    policy,
    new AbortController().signal,
    publicResolver,
  )
  assert.equal(pinned.url.href, sourceUrl)
  assert.deepEqual(pinned.address, { address: '8.8.8.8', family: 4 })
})

test('source policy stops waiting for a stalled DNS lookup without sending a request', async () => {
  const controller = new AbortController()
  let complete!: (value: readonly { address: string; family: 4 }[]) => void
  const pending = new Promise<readonly { address: string; family: 4 }[]>((resolve) => {
    complete = resolve
  })
  const work = pinSourceDestination(sourceUrl, policy, controller.signal, async () => pending)
  controller.abort()
  await assert.rejects(work, /research_cancelled/)
  complete([{ address: '8.8.8.8', family: 4 }])
})

test('source fetch sends only a pinned admitted URL and never follows or retries a redirect', async () => {
  let sends = 0
  const fetchSource = sourceFetcher(policy, {
    resolve: publicResolver,
    transport: async (destination) => {
      sends += 1
      assert.equal(destination.url.href, sourceUrl)
      assert.deepEqual(destination.address, { address: '8.8.8.8', family: 4 })
      return { status: 302, mediaType: 'text/plain', bytes: Buffer.from('redirect') }
    },
  })
  await assert.rejects(
    fetchSource(sourceUrl, new AbortController().signal),
    /research_source_unavailable/,
  )
  assert.equal(sends, 1)

  await assert.rejects(
    fetchSource('https://127.0.0.1/anything', new AbortController().signal),
    /research_source_refused/,
  )
  assert.equal(sends, 1)
})

test('actual pinned transport retains Host while connecting only to its supplied address with no credentials', async () => {
  let requests = 0
  const endpoint = createServer((request, response) => {
    requests += 1
    assert.equal(request.headers.host, `source.invalid:${(endpoint.address() as AddressInfo).port}`)
    assert.equal(request.headers.authorization, undefined)
    assert.equal(request.headers.cookie, undefined)
    assert.equal(request.method, 'GET')
    assert.equal(request.url, '/data?fixed=1')
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('literal source bytes')
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  try {
    // This independently exercises transport pinning; the public-source policy rejects loopback.
    const port = (endpoint.address() as AddressInfo).port
    const response = await requestPinnedSource(
      {
        url: new URL(`http://source.invalid:${port}/data?fixed=1`),
        address: { address: '127.0.0.1', family: 4 },
      },
      AbortSignal.timeout(1000),
    )
    assert.equal(response.bytes.toString(), 'literal source bytes')
    assert.equal(requests, 1)
  } finally {
    await new Promise<void>((resolve, reject) =>
      endpoint.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('source fetch refuses oversized or unsupported responses and retains exact permitted bytes', async () => {
  for (const response of [
    { status: 200, mediaType: 'text/plain', bytes: Buffer.alloc(MAX_RESEARCH_SOURCE_BYTES + 1) },
    { status: 200, mediaType: 'application/javascript', bytes: Buffer.from('not a document') },
  ]) {
    const fetchSource = sourceFetcher(policy, {
      resolve: publicResolver,
      transport: async () => response,
    })
    await assert.rejects(
      fetchSource(sourceUrl, new AbortController().signal),
      /research_(capacity|source_invalid)/,
    )
  }
  const bytes = Buffer.from('%PDF-1.4\nfixture source\n')
  const fetchSource = sourceFetcher(policy, {
    resolve: publicResolver,
    transport: async () => ({ status: 200, mediaType: 'application/pdf', bytes }),
  })
  const result = await fetchSource(sourceUrl, new AbortController().signal)
  assert.equal(result.url, sourceUrl)
  assert.deepEqual(result.bytes, bytes)
})

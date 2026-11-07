import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import { createServer } from '../src/api/server.ts'

test('capture static dependency serves only its asset root, preserving API guards; patched glob works', async () => {
  const root = await mkdtemp(join(tmpdir(), 'intake-static-'))
  try {
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'assets', 'index.html'), '<h1>Owned capture fixture</h1>')
    await writeFile(join(root, 'assets', 'capture.css'), 'body { color: blue; }')
    await writeFile(join(root, 'private.txt'), 'private-fixture-sentinel')
    await writeFile(join(root, 'assets', '.hidden'), 'hidden-fixture-sentinel')
    // Default wildcard is the main.ts path; false also qualifies the patched glob API.
    for (const wildcard of [true, false]) {
      const config = {
        origin: 'http://127.0.0.1:1',
        actorId: '10000000-0000-4000-8000-000000000001',
        targetId: '20000000-0000-4000-8000-000000000002',
        targetContextId: '30000000-0000-4000-8000-000000000003',
        credentialRef: 'unconfigured',
      }
      const app = createServer(config)
      try {
        await app.register(fastifyStatic, {
          root: join(root, 'assets'),
          index: 'index.html',
          dotfiles: 'deny',
          wildcard,
        })
        config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
        assert.equal(
          await (await fetch(config.origin + '/')).text(),
          '<h1>Owned capture fixture</h1>',
        )
        assert.equal(
          await (await fetch(config.origin + '/capture.css')).text(),
          'body { color: blue; }',
        )
        assert.equal((await fetch(config.origin + '/api/v1/health')).status, 200)
        for (const path of ['/.hidden', '/%2e%2e/private.txt', '/private.txt']) {
          const response = await fetch(config.origin + path)
          assert.ok(response.status >= 400)
          assert.doesNotMatch(await response.text(), /fixture-sentinel/)
        }
        assert.equal(
          (await app.inject({ url: '/', headers: { host: 'untrusted.invalid' } })).statusCode,
          403,
        )
      } finally {
        await app.close()
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

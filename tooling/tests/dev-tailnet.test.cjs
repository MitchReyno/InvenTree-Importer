const test = require('node:test')
const assert = require('node:assert/strict')
const { createServer, request } = require('node:http')
const { connect } = require('node:net')
const { tailscaleOption, tailnetIdentity, translate, createGateway } = require('../dev/tailnet.cjs')

const publicOrigin = 'https://bench.example-tailnet.ts.net'
const login = 'owner@example.com'
const status = {
  BackendState: 'Running',
  Self: { DNSName: 'bench.example-tailnet.ts.net.', Online: true, UserID: 7 },
  User: { 7: { LoginName: login } },
}

test('tailnet serving is opt-in by flag or setting and validates its port', () => {
  assert.equal(tailscaleOption({}, ['node', 'dev.cjs']), null)
  assert.equal(tailscaleOption({ INTAKE_DEV_TAILSCALE: '0' }, []), null)
  assert.deepEqual(tailscaleOption({}, ['--tailscale']), { port: 443 })
  assert.deepEqual(
    tailscaleOption({ INTAKE_DEV_TAILSCALE: '1', INTAKE_DEV_TAILSCALE_PORT: '8443' }, []),
    { port: 8443 },
  )
  assert.throws(
    () => tailscaleOption({ INTAKE_DEV_TAILSCALE: 'yes' }, []),
    /invalid_tailscale_setting/,
  )
  assert.throws(
    () => tailscaleOption({ INTAKE_DEV_TAILSCALE_PORT: '0' }, ['--tailscale']),
    /invalid_tailscale_port/,
  )
})

test('identity is the MagicDNS HTTPS origin and node owner, and requires a running node', () => {
  assert.deepEqual(tailnetIdentity(status), { origin: publicOrigin, login })
  assert.equal(tailnetIdentity(status, 8443).origin, `${publicOrigin}:8443`)
  assert.throws(
    () => tailnetIdentity({ ...status, BackendState: 'Stopped' }),
    /tailscale_not_running/,
  )
  assert.throws(
    () => tailnetIdentity({ ...status, Self: { ...status.Self, DNSName: '' } }),
    /tailscale_not_running/,
  )
  assert.throws(() => tailnetIdentity({ ...status, User: {} }), /tailscale_owner_unknown/)
})

test('translation admits only the tailnet host, origin and owner, and presents the loopback origin', () => {
  const options = { publicOrigin, loopbackOrigin: 'http://127.0.0.1:4330', login }
  const admitted = {
    host: 'bench.example-tailnet.ts.net',
    origin: publicOrigin,
    'tailscale-user-login': login,
    'tailscale-user-name': 'Owner',
    'x-intake-csrf': 'token',
  }
  assert.deepEqual(translate(admitted, options), {
    host: '127.0.0.1:4330',
    origin: 'http://127.0.0.1:4330',
    'x-intake-csrf': 'token',
  })
  const { origin: _origin, ...navigation } = admitted
  assert.equal(translate(navigation, options).origin, undefined)
  for (const refused of [
    { ...admitted, host: '127.0.0.1:4330' },
    { ...admitted, host: '100.64.0.1' },
    { ...admitted, origin: 'https://attacker.example' },
    { ...admitted, origin: 'null' },
    { ...admitted, 'tailscale-user-login': 'someone-else@example.com' },
    { host: admitted.host, origin: publicOrigin },
  ]) {
    assert.equal(translate(refused, options), null)
  }
})

async function listen(server) {
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return server.address().port
}

function get(port, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/v1/bootstrap', headers }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

function upgrade(port, headers) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let text = ''
    socket.on('data', (chunk) => {
      text += chunk
      if (text.includes('\r\n\r\n') && (text.includes('echo:ping') || !text.includes(' 101 '))) {
        socket.destroy()
        resolve(text)
      }
    })
    socket.on('error', reject)
    const lines = Object.entries({
      connection: 'Upgrade',
      upgrade: 'websocket',
      ...headers,
    }).map(([key, value]) => `${key}: ${value}`)
    socket.write(`GET /api/v1/live HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
    socket.once('data', () => socket.write('ping'))
  })
}

test('gateway forwards admitted HTTP and upgrade requests to loopback with translated headers', async (t) => {
  const seen = []
  const upgraded = new Set()
  const upstream = createServer((req, res) => {
    seen.push(req.headers)
    res.end('upstream')
  })
  upstream.on('upgrade', (req, socket) => {
    seen.push(req.headers)
    upgraded.add(socket)
    socket.on('end', () => socket.end())
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n',
    )
    socket.on('data', (chunk) => socket.write(`echo:${chunk}`))
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGateway({
    publicOrigin,
    loopbackOrigin: `http://127.0.0.1:${upstreamPort}`,
    login,
  })
  const port = await listen(gateway)
  t.after(() => {
    gateway.closeAllConnections()
    gateway.close()
    upstream.closeAllConnections()
    upstream.close()
    for (const socket of upgraded) {
      socket.destroy()
    }
  })
  const admitted = {
    host: 'bench.example-tailnet.ts.net',
    origin: publicOrigin,
    'tailscale-user-login': login,
  }

  assert.deepEqual(await get(port, admitted), { status: 200, body: 'upstream' })
  assert.equal(seen[0].host, `127.0.0.1:${upstreamPort}`)
  assert.equal(seen[0].origin, `http://127.0.0.1:${upstreamPort}`)
  assert.equal(seen[0]['tailscale-user-login'], undefined)

  assert.equal((await get(port, { ...admitted, origin: 'https://attacker.example' })).status, 403)
  assert.equal((await get(port, { ...admitted, host: `127.0.0.1:${port}` })).status, 403)
  assert.equal(seen.length, 1)

  const switched = await upgrade(port, admitted)
  assert.match(switched, /^HTTP\/1\.1 101 /)
  assert.match(switched, /echo:ping/)
  assert.equal(seen[1].host, `127.0.0.1:${upstreamPort}`)
  assert.equal(seen[1].origin, `http://127.0.0.1:${upstreamPort}`)

  assert.match(
    await upgrade(port, { ...admitted, 'tailscale-user-login': 'other' }),
    /^HTTP\/1\.1 403 /,
  )
  assert.equal(seen.length, 2)
})

const { createServer, request } = require('node:http')
const { execFile } = require('node:child_process')

const IDENTITY_HEADERS = /^tailscale-/

/** Opt-in tailnet HTTPS; the port is the `tailscale serve --https` port. */
function tailscaleOption(settings, argv = process.argv) {
  const flag = settings.INTAKE_DEV_TAILSCALE
  if (flag !== undefined && flag !== '0' && flag !== '1') {
    throw new Error('invalid_tailscale_setting')
  }
  if (!argv.includes('--tailscale') && flag !== '1') {
    return null
  }
  const port = Number(settings.INTAKE_DEV_TAILSCALE_PORT ?? 443)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('invalid_tailscale_port')
  }
  return { port }
}

/** This node's MagicDNS origin and owner login, from `tailscale status --json`. */
function tailnetIdentity(status, httpsPort = 443) {
  const self = status?.Self
  const dnsName = typeof self?.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : ''
  if (status?.BackendState !== 'Running' || !self?.Online || !dnsName) {
    throw new Error('tailscale_not_running')
  }
  const login = status.User?.[String(self.UserID)]?.LoginName
  if (typeof login !== 'string' || !login) {
    throw new Error('tailscale_owner_unknown')
  }
  const origin = new URL(`https://${dnsName}:${httpsPort}`).origin
  return { origin, login }
}

function readTailnetIdentity(executable, httpsPort, env) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['status', '--json'],
      { env, timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error('tailscale_unavailable'))
          return
        }
        try {
          resolve(tailnetIdentity(JSON.parse(stdout), httpsPort))
        } catch (failure) {
          reject(failure instanceof SyntaxError ? new Error('tailscale_unavailable') : failure)
        }
      },
    )
  })
}

/**
 * Admits only the tailnet origin for the node owner, then presents the request as the loopback
 * origin so the API's exact Host/Origin checks still decide everything downstream.
 */
function translate(headers, { publicOrigin, loopbackOrigin, login }) {
  if (headers.host !== new URL(publicOrigin).host) {
    return null
  }
  if (headers.origin !== undefined && headers.origin !== publicOrigin) {
    return null
  }
  if (headers['tailscale-user-login'] !== login) {
    return null
  }
  const forwarded = Object.fromEntries(
    Object.entries(headers).filter(([key]) => !IDENTITY_HEADERS.test(key)),
  )
  forwarded.host = new URL(loopbackOrigin).host
  if (headers.origin !== undefined) {
    forwarded.origin = loopbackOrigin
  }
  return forwarded
}

function upgradeHead(response) {
  const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`]
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`)
  }
  return lines.join('\r\n') + '\r\n\r\n'
}

function createGateway(options) {
  const upstream = new URL(options.loopbackOrigin)
  const target = (req, headers) => ({
    host: upstream.hostname,
    port: upstream.port,
    method: req.method,
    path: req.url,
    headers,
  })

  const server = createServer((req, res) => {
    const headers = translate(req.headers, options)
    if (!headers) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Tailnet request refused.\n')
      return
    }
    const forward = request(target(req, headers), (response) => {
      res.writeHead(response.statusCode, response.statusMessage, response.rawHeaders)
      response.pipe(res)
    })
    forward.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' })
      }
      res.end()
    })
    req.pipe(forward)
  })

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy())
    const headers = translate(req.headers, options)
    if (!headers) {
      socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n')
      return
    }
    const forward = request(target(req, headers))
    forward.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      upstreamSocket.on('error', () => socket.destroy())
      socket.on('close', () => upstreamSocket.destroy())
      upstreamSocket.on('close', () => socket.destroy())
      socket.write(upgradeHead(response))
      if (upstreamHead.length) {
        socket.write(upstreamHead)
      }
      if (head.length) {
        upstreamSocket.write(head)
      }
      upstreamSocket.pipe(socket).pipe(upstreamSocket)
    })
    forward.on('response', (response) => {
      socket.write(upgradeHead(response))
      response.pipe(socket)
    })
    forward.on('error', () => socket.destroy())
    forward.end()
  })
  return server
}

async function main() {
  const port = Number(process.env.INTAKE_DEV_TAILNET_GATEWAY_PORT)
  const publicPort = Number(process.env.INTAKE_DEV_PUBLIC_PORT)
  for (const value of [port, publicPort]) {
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error('invalid_development_port')
    }
  }
  const publicOrigin = process.env.INTAKE_DEV_TAILNET_ORIGIN
  const login = process.env.INTAKE_DEV_TAILNET_LOGIN
  if (!publicOrigin || new URL(publicOrigin).origin !== publicOrigin || !login) {
    throw new Error('invalid_tailnet_gateway')
  }
  const server = createGateway({
    publicOrigin,
    loopbackOrigin: `http://127.0.0.1:${publicPort}`,
    login,
  })
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', done)
  })
  // Stateless; upgraded sockets would otherwise outlive server.close().
  process.once('SIGTERM', () => process.exit(0))
  process.stdout.write('DEV_TAILNET_READY\n')
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('Tailnet gateway failed.\n')
    process.exitCode = 1
  })
}

module.exports = { tailscaleOption, tailnetIdentity, readTailnetIdentity, translate, createGateway }

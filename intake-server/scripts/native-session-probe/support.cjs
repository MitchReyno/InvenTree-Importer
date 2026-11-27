// Proof-of-fit for design D2: a loopback Streamable HTTP MCP endpoint on Fastify,
// bearer capabilities stored only as SHA-256 digests, and stage-scoped tool sets.
// Runs the same checks against MCP SDK v2 and v1. Offline; no provider is started.
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const { request } = require('node:http')
const Fastify = require('fastify')

const LEAD_TOOLS = ['read_batch', 'record_observation', 'propose_lot', 'regroup']
const COMMON_TOOLS = ['status', 'propose', 'ask', 'reply', 'fetch_evidence', 'read_inbox']

const digest = (token) => createHash('sha256').update(token).digest()

function createCapabilityStore() {
  const sessions = new Map() // hex digest -> session
  return {
    issue(session) {
      const token = randomBytes(32).toString('base64url')
      sessions.set(digest(token).toString('hex'), session)
      return token
    },
    resolve(header) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '')
      if (!match) return undefined
      const candidate = digest(match[1])
      for (const [stored, session] of sessions) {
        if (timingSafeEqual(Buffer.from(stored, 'hex'), candidate)) return session
      }
      return undefined
    },
  }
}

function toolNamesFor(session) {
  return session.stage === 'examine' ? [...COMMON_TOOLS, ...LEAD_TOOLS] : COMMON_TOOLS
}

function registerTools(server, session, calls) {
  for (const name of toolNamesFor(session)) {
    server.registerTool(
      name,
      {
        description: `spike ${name}`,
        inputSchema: {
          '~standard': {
            version: 1,
            vendor: 'intake-probe',
            validate: (value) => ({ value }),
            jsonSchema: {
              input: () => ({
                type: 'object',
                properties: { text: { type: 'string', maxLength: 120 } },
                additionalProperties: false,
              }),
              output: () => ({ type: 'object' }),
            },
          },
        },
      },
      async (args, ctx) => {
        // v2 passes ctx.http.authInfo; v1 passes extra.authInfo.
        const auth = ctx?.http?.authInfo ?? ctx?.authInfo
        calls.push({ tool: name, session: auth?.extra?.sessionId, args })
        const body = { ok: true, tool: name, pending_inbox: session.pendingInbox }
        return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body }
      },
    )
  }
}

async function loadSdk(line) {
  if (line === 'v2') {
    const { McpServer } = await import('@modelcontextprotocol/server')
    const { NodeStreamableHTTPServerTransport, localhostHostValidation } =
      await import('@modelcontextprotocol/node')
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
    return {
      McpServer,
      ServerTransport: NodeStreamableHTTPServerTransport,
      hostGuard: localhostHostValidation(),
      Client,
      ClientTransport: StreamableHTTPClientTransport,
    }
  }
  throw new Error('Only the installed MCP v2 stack is supported')
}

async function startEndpoint(sdk, capabilities, calls) {
  const app = Fastify({ logger: false })
  const handle = async (request, reply) => {
    reply.hijack()
    const { raw: req } = request
    const res = reply.raw
    if (!sdk.hostGuard(req, res)) return
    const session = capabilities.resolve(req.headers.authorization)
    if (!session) {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"error":"invalid_capability"}')
      return
    }
    req.auth = {
      token: 'redacted',
      clientId: session.sessionId,
      scopes: [],
      extra: { sessionId: session.sessionId },
    }
    const server = new sdk.McpServer({ name: 'intake', version: '0.0.0-spike' })
    registerTools(server, session, calls)
    const transport = new sdk.ServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, request.body)
  }
  app.post('/mcp', handle)
  app.get('/mcp', handle)
  app.delete('/mcp', handle)
  await app.listen({ host: '127.0.0.1', port: 0 })
  return { app, url: `http://127.0.0.1:${app.server.address().port}/mcp` }
}

module.exports = { createCapabilityStore, loadSdk, startEndpoint }

// Proof-of-fit for design D2: a loopback Streamable HTTP MCP endpoint on Fastify,
// bearer capabilities stored only as SHA-256 digests, and stage-scoped tool sets.
// Runs the same checks against MCP SDK v2 and v1. Offline; no provider is started.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { request } from 'node:http';
import Fastify from 'fastify';
import * as z from 'zod';

const LEAD_TOOLS = ['record_observation', 'propose_lot', 'regroup'];
const COMMON_TOOLS = ['status', 'propose', 'ask', 'reply', 'fetch_evidence', 'read_inbox'];

const digest = (token) => createHash('sha256').update(token).digest();

export function createCapabilityStore() {
  const sessions = new Map(); // hex digest -> session
  return {
    issue(session) {
      const token = randomBytes(32).toString('base64url');
      sessions.set(digest(token).toString('hex'), session);
      return token;
    },
    resolve(header) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
      if (!match) return undefined;
      const candidate = digest(match[1]);
      for (const [stored, session] of sessions) {
        if (timingSafeEqual(Buffer.from(stored, 'hex'), candidate)) return session;
      }
      return undefined;
    },
  };
}

function toolNamesFor(session) {
  return session.stage === 'examine' ? [...COMMON_TOOLS, ...LEAD_TOOLS] : COMMON_TOOLS;
}

function registerTools(server, session, calls) {
  for (const name of toolNamesFor(session)) {
    server.registerTool(
      name,
      { description: `spike ${name}`, inputSchema: z.object({ text: z.string().max(120).optional() }) },
      async (args, ctx) => {
        // v2 passes ctx.http.authInfo; v1 passes extra.authInfo.
        const auth = ctx?.http?.authInfo ?? ctx?.authInfo;
        calls.push({ tool: name, session: auth?.extra?.sessionId, args });
        const body = { ok: true, tool: name, pending_inbox: session.pendingInbox };
        return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
      },
    );
  }
}

export async function loadSdk(line) {
  if (line === 'v2') {
    const { McpServer } = await import('@modelcontextprotocol/server');
    const { NodeStreamableHTTPServerTransport, localhostHostValidation } = await import(
      '@modelcontextprotocol/node'
    );
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    return {
      McpServer,
      ServerTransport: NodeStreamableHTTPServerTransport,
      hostGuard: localhostHostValidation(),
      Client,
      ClientTransport: StreamableHTTPClientTransport,
    };
  }
  const { McpServer } = await import('mcp-sdk-v1/server/mcp.js');
  const { StreamableHTTPServerTransport } = await import('mcp-sdk-v1/server/streamableHttp.js');
  const { Client } = await import('mcp-sdk-v1/client/index.js');
  const { StreamableHTTPClientTransport } = await import('mcp-sdk-v1/client/streamableHttp.js');
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const hostGuard = (req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (allowed.has(host)) return true;
    res.writeHead(403).end();
    return false;
  };
  return {
    McpServer,
    ServerTransport: StreamableHTTPServerTransport,
    hostGuard,
    Client,
    ClientTransport: StreamableHTTPClientTransport,
  };
}

export async function startEndpoint(sdk, capabilities, calls) {
  const app = Fastify({ logger: false });
  const handle = async (request, reply) => {
    reply.hijack();
    const { raw: req } = request;
    const res = reply.raw;
    if (!sdk.hostGuard(req, res)) return;
    const session = capabilities.resolve(req.headers.authorization);
    if (!session) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"invalid_capability"}');
      return;
    }
    req.auth = { token: 'redacted', clientId: session.sessionId, scopes: [], extra: { sessionId: session.sessionId } };
    const server = new sdk.McpServer({ name: 'intake', version: '0.0.0-spike' });
    registerTools(server, session, calls);
    const transport = new sdk.ServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, request.body);
  };
  app.post('/mcp', handle);
  app.get('/mcp', handle);
  app.delete('/mcp', handle);
  await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, url: `http://127.0.0.1:${app.server.address().port}/mcp` };
}

async function connectClient(sdk, url, token) {
  const client = new sdk.Client({ name: 'spike-client', version: '0.0.0' });
  const transport = new sdk.ClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

async function expectFailure(label, fn) {
  try {
    await fn();
  } catch (error) {
    return { label, refused: true, message: String(error?.message ?? error).slice(0, 160) };
  }
  return { label, refused: false };
}

async function runLine(line) {
  const sdk = await loadSdk(line);
  const capabilities = createCapabilityStore();
  const calls = [];
  const leadToken = capabilities.issue({ sessionId: 'lead-1', stage: 'examine', pendingInbox: 2 });
  const lotToken = capabilities.issue({ sessionId: 'lot-7', stage: 'research', pendingInbox: 0 });
  const { app, url } = await startEndpoint(sdk, capabilities, calls);
  const results = { line, boundTo: url.replace(/:\d+\/mcp$/, ''), checks: {} };
  try {
    const lead = await connectClient(sdk, url, leadToken);
    const leadTools = (await lead.listTools()).tools.map((tool) => tool.name).sort();
    const leadCall = await lead.callTool({ name: 'record_observation', arguments: { text: 'two TO-92 parts' } });
    results.checks.leadTools = leadTools;
    results.checks.leadPendingInbox = leadCall.structuredContent?.pending_inbox;
    await lead.close();

    const lot = await connectClient(sdk, url, lotToken);
    const lotTools = (await lot.listTools()).tools.map((tool) => tool.name).sort();
    results.checks.lotTools = lotTools;
    results.checks.lotHasLeadTools = LEAD_TOOLS.some((name) => lotTools.includes(name));
    const refusedLeadTool = await lot.callTool({ name: 'propose_lot', arguments: {} }).then(
      (result) => ({ refused: Boolean(result.isError), text: result.content?.[0]?.text?.slice(0, 120) }),
      (error) => ({ refused: true, message: String(error.message).slice(0, 120) }),
    );
    results.checks.lotCallsLeadTool = refusedLeadTool;
    const overlong = await lot.callTool({ name: 'status', arguments: { text: 'x'.repeat(121) } }).then(
      (result) => ({ refused: Boolean(result.isError) }),
      () => ({ refused: true }),
    );
    results.checks.statusOver120Refused = overlong.refused;
    await lot.close();

    results.checks.wrongToken = await expectFailure('wrong token', async () => {
      const client = await connectClient(sdk, url, randomBytes(32).toString('base64url'));
      await client.listTools();
    });
    const missing = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    results.checks.missingTokenStatus = missing.status;
    // fetch() drops a caller-set Host header, so send the rebinding probe with node:http.
    results.checks.foreignHostStatus = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const probe = request(url, {
        method: 'POST',
        headers: {
          host: 'evil.example',
          authorization: `Bearer ${leadToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
      }, (res) => { res.resume(); resolve(res.statusCode); });
      probe.on('error', reject);
      probe.end(body);
    });
    results.checks.toolCallsAttributed = calls.map((call) => `${call.session}:${call.tool}`);
  } finally {
    await app.close();
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = { node: process.version, fastify: (await import('fastify/package.json', { with: { type: 'json' } })).default.version, lines: [] };
  for (const line of ['v2', 'v1']) output.lines.push(await runLine(line));
  console.log(JSON.stringify(output, null, 2));
}

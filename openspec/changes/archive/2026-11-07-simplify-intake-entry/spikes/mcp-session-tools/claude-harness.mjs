// Offline check of the Claude CLI boundary for design D2/D3. Runs the real `claude`
// binary against a loopback stub of the Messages API with a fake API key, `--bare`
// (no keychain) and a throwaway HOME, so no provider is contacted and no real
// credential is used. The stub records tool names and message shapes, never headers.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCapabilityStore, loadSdk, startEndpoint } from './run-spike.mjs';

const CLAUDE = process.env.SPIKE_CLAUDE_EXECUTABLE ?? 'claude';

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

function assistantEvents(blocks, stopReason) {
  const events = [
    {
      type: 'message_start',
      message: {
        id: `msg_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: 'stub-model',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
  ];
  blocks.forEach((block, index) => {
    if (block.type === 'tool_use') {
      events.push({ type: 'content_block_start', index, content_block: { ...block, input: {} } });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  events.push({ type: 'message_stop' });
  return events;
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ');

// Turn script: the first request in a turn calls mcp__intake__status; once a tool
// result is present it ends the turn with text. `delayFirstMs` holds the first
// response open so a stdin message can arrive mid-turn.
async function startStub({ delayFirstMs = 0 } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":1}');
        return;
      }
      const body = JSON.parse(raw || '{}');
      const messages = body.messages ?? [];
      const last = messages.at(-1);
      const hasToolResult = Array.isArray(last?.content) && last.content.some((b) => b.type === 'tool_result');
      requests.push({
        tools: (body.tools ?? []).map((tool) => tool.name).sort(),
        userTexts: messages.filter((m) => m.role === 'user').map((m) => textOf(m.content)).filter(Boolean),
        toolResults: messages
          .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
          .filter((b) => b.type === 'tool_result')
          .map((b) => (typeof b.content === 'string' ? b.content : textOf(b.content)).slice(0, 160)),
        messageCount: messages.length,
        authKind: req.headers['x-api-key'] === 'sk-ant-spike-fake' ? 'fake-api-key' : req.headers.authorization ? 'other-bearer' : 'none',
        systemHasUserMemoryMarker: JSON.stringify(body.system ?? '').includes('SPIKE-USER-MEMORY-MARKER') || JSON.stringify(messages).includes('SPIKE-USER-MEMORY-MARKER'),
        shape: messages.map((m) => `${m.role}[${(Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]).map((b) => b.type === 'text' ? `text:${b.text.slice(0, 50)}` : b.type === 'tool_result' ? `tool_result:${(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 40)}` : b.type).join('|')}]`),
      });
      if (requests.length === 1 && delayFirstMs) await new Promise((r) => setTimeout(r, delayFirstMs));
      const toolAvailable = (body.tools ?? []).some((tool) => tool.name === 'mcp__intake__status');
      if (!hasToolResult && toolAvailable) {
        sse(res, assistantEvents([
          { type: 'tool_use', id: `toolu_${requests.length}`, name: 'mcp__intake__status', input: { text: 'Reading the label' } },
        ], 'tool_use'));
      } else {
        sse(res, assistantEvents([{ type: 'text', text: `done after ${messages.length} messages` }], 'end_turn'));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
}

async function runClaude({ home, stubUrl, mcpConfigPath, capability, extraArgs, inputs, inputDelaysMs = [], bare = true }) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, 'config'),
    TMPDIR: home,
    ANTHROPIC_API_KEY: 'sk-ant-spike-fake',
    ANTHROPIC_BASE_URL: stubUrl,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
  };
  if (capability !== undefined) env.INTAKE_TOOL_CAPABILITY = capability;
  const args = [
    ...(bare ? ['--bare'] : []),
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--tools', '',
    '--strict-mcp-config',
    '--mcp-config', mcpConfigPath,
    '--setting-sources', '',
    '--model', 'claude-sonnet-5-5',
    ...extraArgs,
  ];
  const child = spawn(CLAUDE, args, { cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let index;
    while ((index = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, index);
      stdout = stdout.slice(index + 1);
      if (line.trim()) lines.push(JSON.parse(line));
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  for (let i = 0; i < inputs.length; i += 1) {
    if (inputDelaysMs[i]) await new Promise((r) => setTimeout(r, inputDelaysMs[i]));
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: inputs[i] }] } })}\n`);
  }
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('close', resolve));
  const init = lines.find((line) => line.type === 'system' && line.subtype === 'init');
  const results = lines.filter((line) => line.type === 'result');
  return {
    code,
    stderr: stderr.trim().slice(0, 300),
    sessionId: init?.session_id,
    initTools: init?.tools,
    initMcpServers: init?.mcp_servers,
    results: results.map((r) => ({ subtype: r.subtype, is_error: r.is_error, result: r.result, num_turns: r.num_turns })),
    permissionDenials: results.flatMap((r) => r.permission_denials ?? []).map((d) => d.tool_name),
  };
}

async function scenario(name, fn) {
  const home = await mkdtemp(join(tmpdir(), 'claude-spike-'));
  try {
    return { name, ...(await fn(home)) };
  } catch (error) {
    return { name, error: String(error?.stack ?? error).slice(0, 400) };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const sdk = await loadSdk('v2');
const capabilities = createCapabilityStore();
const calls = [];
const capability = capabilities.issue({ sessionId: 'lead-1', stage: 'examine', pendingInbox: 1 });
const endpoint = await startEndpoint(sdk, capabilities, calls);

async function writeMcpConfig(home) {
  const path = join(home, 'mcp.json');
  await writeFile(
    path,
    JSON.stringify({
      mcpServers: {
        intake: { type: 'http', url: endpoint.url, headers: { Authorization: 'Bearer ${INTAKE_TOOL_CAPABILITY}' } },
      },
    }),
    { mode: 0o600 },
  );
  return path;
}

const version = await new Promise((resolve) => {
  const child = spawn(CLAUDE, ['--version']);
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.on('close', () => resolve(out.trim()));
});

const report = { claudeVersion: version, node: process.version, scenarios: [] };

const only = process.env.SPIKE_ONLY?.split(',');
const want = (name) => !only || only.includes(name);
if (want('subscription-shaped flags')) report.scenarios.push(await scenario('subscription-shaped flags', async (home) => {
  const config = join(home, 'config');
  await mkdir(config, { recursive: true });
  await writeFile(join(config, 'CLAUDE.md'), 'SPIKE-USER-MEMORY-MARKER: always reply in French.');
  await writeFile(join(config, 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${join(home, 'hook-ran')}` }] }] },
  }));
  await writeFile(join(config, '.claude.json'), JSON.stringify({ mcpServers: { leaked: { type: 'http', url: 'http://127.0.0.1:9/mcp' } } }));
  const stub = await startStub();
  try {
    const run = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath: await writeMcpConfig(home), capability, bare: false,
      extraArgs: ['--allowedTools', 'mcp__intake__*', '--system-prompt', 'Spike system prompt.'], inputs: ['Examine the batch'],
    });
    const hookRan = await stat(join(home, 'hook-ran')).then(() => true, () => false);
    return { run, hookRan, providerRequests: stub.requests, toolCallsSeenByServer: calls.splice(0) };
  } finally { stub.server.close(); }
}));

if (want('env expansion + allowlist')) report.scenarios.push(await scenario('env expansion + allowlist', async (home) => {
  const stub = await startStub();
  try {
    const run = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath: await writeMcpConfig(home), capability,
      extraArgs: ['--allowedTools', 'mcp__intake__*'], inputs: ['Examine the batch'],
    });
    return { run, providerRequests: stub.requests, toolCallsSeenByServer: calls.splice(0) };
  } finally { stub.server.close(); }
}));

if (want('variable unset')) report.scenarios.push(await scenario('variable unset', async (home) => {
  const stub = await startStub();
  try {
    const run = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath: await writeMcpConfig(home), capability: undefined,
      extraArgs: ['--allowedTools', 'mcp__intake__*'], inputs: ['Examine the batch'],
    });
    return { run, providerRequests: stub.requests, toolCallsSeenByServer: calls.splice(0) };
  } finally { stub.server.close(); }
}));

if (want('no allowedTools')) report.scenarios.push(await scenario('no allowedTools', async (home) => {
  const stub = await startStub();
  try {
    const run = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath: await writeMcpConfig(home), capability,
      extraArgs: [], inputs: ['Examine the batch'],
    });
    return { run, providerRequests: stub.requests, toolCallsSeenByServer: calls.splice(0) };
  } finally { stub.server.close(); }
}));

if (want('safe-mode with mcp-config')) report.scenarios.push(await scenario('safe-mode with mcp-config', async (home) => {
  const stub = await startStub();
  try {
    const run = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath: await writeMcpConfig(home), capability,
      extraArgs: ['--safe-mode', '--allowedTools', 'mcp__intake__*'], inputs: ['Examine the batch'],
    });
    return { run, providerRequests: stub.requests, toolCallsSeenByServer: calls.splice(0) };
  } finally { stub.server.close(); }
}));

if (want('persist then resume')) report.scenarios.push(await scenario('persist then resume', async (home) => {
  const stub = await startStub();
  try {
    const mcpConfigPath = await writeMcpConfig(home);
    const sessionId = randomUUID();
    const first = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath, capability,
      extraArgs: ['--allowedTools', 'mcp__intake__*', '--session-id', sessionId], inputs: ['First turn'],
    });
    const firstRequests = stub.requests.splice(0);
    const resumed = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath, capability,
      extraArgs: ['--allowedTools', 'mcp__intake__*', '--resume', sessionId], inputs: ['Answer: it is a BC547'],
    });
    return {
      sessionId,
      first: { sessionId: first.sessionId, results: first.results, requests: firstRequests.length },
      resumed: { sessionId: resumed.sessionId, results: resumed.results, stderr: resumed.stderr },
      resumedRequests: stub.requests,
      toolCallsSeenByServer: calls.splice(0),
    };
  } finally { stub.server.close(); }
}));

if (want('stdin message during a turn')) report.scenarios.push(await scenario('stdin message during a turn', async (home) => {
  const stub = await startStub({ delayFirstMs: 3000 });
  try {
    const run = await runClaude({
      home, stubUrl: stub.url, mcpConfigPath: await writeMcpConfig(home), capability,
      extraArgs: ['--allowedTools', 'mcp__intake__*'],
      inputs: ['Examine the batch', 'Operator chat: the reel is 1k ohm'], inputDelaysMs: [0, 1500],
    });
    return { run, providerRequests: stub.requests, toolCallsSeenByServer: calls.splice(0) };
  } finally { stub.server.close(); }
}));

await endpoint.app.close();
console.log(JSON.stringify(report, null, 2));

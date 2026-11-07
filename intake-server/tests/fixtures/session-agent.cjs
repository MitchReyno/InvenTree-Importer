// Deterministic session executable for Claude stream-JSON and Codex app-server. It calls the real
// intake tool server over loopback HTTP and never contacts a provider.
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const args = process.argv.slice(2)
// The adapter passes only an allowlisted environment, so the test leaves its settings in the
// private session directory the child runs in.
const settingsFile = path.join(process.cwd(), 'fake-session.json')
const settings = fs.existsSync(settingsFile)
  ? JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  : {}
// A test that cannot reach the session directory first may bake a mode into the executable.
// eslint-disable-next-line no-undef
const mode = settings.mode ?? (typeof FORCED_MODE === 'string' ? FORCED_MODE : 'normal')
if (args.includes('--version')) {
  process.stdout.write(mode === 'unknown-version' ? '2.1.320 (Claude Code)\n' : '2.1.319 (Claude Code)\n')
  process.exit(0)
}
const log = (entry) => {
  if (settings.log) {
    fs.appendFileSync(settings.log, JSON.stringify(entry) + '\n')
  }
}
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const sessionsDir = path.join(process.cwd(), 'fake-sessions')
const TOOLS = settings.tools ?? ['ask', 'fetch_evidence', 'propose', 'read_inbox', 'reply', 'status']

if (mode === 'ignore-sigterm') {
  process.on('SIGTERM', () => log({ event: 'sigterm-ignored' }))
}

function toolTarget() {
  if (args[0] === 'app-server') {
    const override = args.find((arg) => arg.startsWith('mcp_servers.intake='))
    const url = /url="([^"]+)"/.exec(override)[1]
    const variable = /bearer_token_env_var="([^"]+)"/.exec(override)[1]
    return { url, token: process.env[variable] }
  }
  const file = args[args.indexOf('--mcp-config') + 1]
  const raw = fs.readFileSync(file, 'utf8')
  log({
    event: 'mcp-config',
    contains_capability: raw.includes(process.env.INTAKE_TOOL_CAPABILITY),
  })
  const server = JSON.parse(raw).mcpServers.intake
  const header = server.headers.Authorization.replace(
    /\$\{([A-Z_]+)\}/g,
    (_, name) => process.env[name] ?? '',
  )
  return { url: server.url, token: header.replace(/^Bearer /, '') }
}

let rpc = 0
async function callTool(name, toolArgs) {
  const { url, token } = toolTarget()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpc,
      method: 'tools/call',
      params: { name, arguments: toolArgs },
    }),
  })
  const body = await response.json()
  const result = body.result?.structuredContent
  log({ event: 'tool', name, status: response.status, ok: result?.ok, error: result?.error })
  return result
}

/** Calls status, then (in delivery mode) waits for an in-turn message naming an inbox item. */
async function work(waitForDelivery) {
  log({ event: 'capability', value: toolTarget().token })
  await callTool('status', { text: 'Reading the evidence' })
  if (mode === 'crash') {
    process.exit(3)
  }
  if (mode === 'ignore-sigterm') {
    await new Promise(() => {})
  }
  if (mode === 'hold') {
    log({ event: 'holding', cwd: process.cwd() })
    while (!fs.existsSync(path.join(process.cwd(), 'release'))) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  if (mode === 'deliver-no-ack') {
    await waitForDelivery()
  }
  if (mode === 'deliver') {
    const delivered = await waitForDelivery()
    const seq = /sequence (\d+)/.exec(delivered)?.[1]
    if (seq) {
      await callTool('read_inbox', { after_seq: seq })
    }
  }
  if (mode === 'reply') {
    const read = await callTool('read_inbox', { after_seq: '0' })
    for (const item of read.items ?? []) {
      if (item.kind === 'chat') {
        await callTool('reply', { inbox_item_id: item.id, text: 'Noted, thanks.' })
      }
    }
    const last = read.items?.at(-1)
    if (last) {
      await callTool('read_inbox', { after_seq: last.seq })
    }
  }
}

function persisted(id) {
  return fs.existsSync(path.join(sessionsDir, id))
}
function persist(id) {
  fs.mkdirSync(sessionsDir, { recursive: true })
  fs.writeFileSync(path.join(sessionsDir, id), 'transcript')
}

function inbox() {
  const queue = []
  let waiter
  return {
    push(text) {
      log({ event: 'delivered', text })
      queue.push(text)
      waiter?.()
    },
    next() {
      return new Promise((resolve) => {
        const take = () => (queue.length ? resolve(queue.shift()) : (waiter = take))
        take()
      })
    },
  }
}

/** The effective policy a real app-server reports; `loose-policy` widens the sandbox. */
function threadReply(id) {
  const apiKey = args.some((arg) => arg.includes('model_provider="bench_openai"'))
  return {
    thread: { id },
    model: 'fake-codex-model',
    approvalPolicy: 'never',
    sandbox: { type: mode === 'loose-policy' ? 'workspaceWrite' : 'readOnly' },
    modelProvider: apiKey ? 'bench_openai' : 'openai',
  }
}

if (args[0] === 'app-server') {
  const deliveries = inbox()
  let threadId
  let turnId
  const lines = readline.createInterface({ input: process.stdin })
  lines.on('line', async (line) => {
    const frame = JSON.parse(line)
    const reply = (result) => send({ id: frame.id, result })
    if (frame.method === 'initialize') reply({ userAgent: mode === 'unknown-version' ? 'bench_intake/0.166.1' : 'bench_intake/0.166.0 (test)' })
    if (frame.method === 'thread/start') {
      threadId = `fake-thread-${Date.now()}`
      persist(threadId)
      reply(threadReply(threadId))
    }
    if (frame.method === 'thread/resume') {
      log({ event: 'resume', id: frame.params.threadId })
      if (mode === 'resume-missing' || !persisted(frame.params.threadId)) {
        send({ id: frame.id, error: { code: -32600, message: 'no rollout found' } })
        return
      }
      threadId = frame.params.threadId
      reply(threadReply(threadId))
    }
    if (frame.method === 'config/read') {
      reply({ config: {
        mcp_servers: { intake: {} }, approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
        features: { code_mode: { enabled: mode === 'code-mode' }, goals: false, shell_tool: false, view_image: false,
          apps: false, plugins: false, remote_plugin: false, memories: false, multi_agent: false, request_permissions_tool: false },
        skills: { bundled: { enabled: false }, include_instructions: mode === 'skills-enabled' },
      } })
    }
    if (frame.method === 'mcpServerStatus/list') {
      const tools = Object.fromEntries(
        [...TOOLS, ...(mode === 'extra-tool' ? ['shell'] : [])].map((name) => [name, {}]),
      )
      reply({ data: [{ name: 'intake', tools }] })
    }
    if (frame.method === 'turn/start') {
      if (mode === 'server-request') send({ id: 9000, method: 'item/tool/requestUserInput', params: {} })
      turnId = `fake-turn-${Date.now()}`
      log({ event: 'opening', text: frame.params.input[0].text })
      reply({ turn: { id: turnId } })
      if (mode === 'command-item' || mode === 'wrapped-call') {
        send({
          method: 'item/started',
          params: { threadId, turnId, item: { type: mode === 'wrapped-call' ? 'codeExecution' : 'commandExecution', id: 'c1', command: 'ls' } },
        })
      }
      await work(() => deliveries.next())
      send({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } })
    }
    if (frame.method === 'turn/steer') {
      if (frame.params.expectedTurnId !== turnId) {
        send({ id: frame.id, error: { code: -32600, message: 'turn mismatch' } })
        return
      }
      reply({ turnId })
      deliveries.push(frame.params.input[0].text)
    }
  })
} else {
  const deliveries = inbox()
  const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : undefined
  const sessionId = resume ?? args[args.indexOf('--session-id') + 1]
  let started = false
  const lines = readline.createInterface({ input: process.stdin })
  lines.on('line', async (line) => {
    const frame = JSON.parse(line)
    if (frame.type === 'control_request') {
      let response
      if (frame.request.subtype === 'initialize') response = {
        claude_code_version: '2.1.319', current_permission_mode: 'default', output_style: 'default', session_state: 'idle',
        commands: mode === 'skills-enabled' ? ['planted'] : [],
        agents: ['claude','Explore','general-purpose','Plan','statusline-setup'].map((name) => ({ name })),
      }
      if (frame.request.subtype === 'mcp_status') response = { mcpServers: [{name:'intake',status:'connected',tools:[...TOOLS,...(mode === 'extra-tool' ? ['shell'] : [])].map((name) => ({name}))}] }
      send({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response}})
      return
    }
    const text = frame.message.content[0].text
    if (started) {
      deliveries.push(text)
      return
    }
    started = true
    if (resume) {
      log({ event: 'resume', id: resume })
      if (mode === 'resume-missing' || !persisted(resume)) {
        process.stderr.write('No conversation found with session ID\n')
        process.exit(1)
      }
    }
    persist(sessionId)
    const tools = [
      ...TOOLS.map((name) => `mcp__intake__${name}`),
      ...(mode === 'extra-tool' ? ['Bash'] : []),
    ]
    send({
      type: 'system',
      subtype: 'init',
      claude_code_version: '2.1.319', permissionMode: 'default', output_style: 'default',
      slash_commands: [], skills: mode === 'skills-enabled' ? ['planted'] : [], additional_directories: [],
      plugins: ['cc-plugin-agents-md', 'cc-plugin-privacy', 'cc-plugin-plugin-authoring'].map((name) => ({name,path:'builtin',source:`${name}@builtin`})),
      session_id: sessionId,
      model: 'fake-claude-model',
      tools,
      mcp_servers: [{ name: 'intake', status: 'connected' }],
    })
    if (mode === 'deferred-call') send({type:'assistant',message:{content:[{type:'tool_use',name:'advisor',input:{}}]}})
    log({ event: 'opening', text })
    await work(() => deliveries.next())
    send({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId })
  })
  lines.on('close', () => process.exit(0))
}

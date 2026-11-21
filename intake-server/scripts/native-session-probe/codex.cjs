async function main() {
  // Offline check of the Codex app-server boundary for design D2/D3. Runs the real
  // `codex app-server` against a loopback stub of the Responses API, with a fake API
  // key and a throwaway CODEX_HOME, so no provider is contacted and no real credential
  // is used. The stub records tool names and input shapes, never headers.
  const { spawn: spawnChild } = require('node:child_process')
  const { mkdir, mkdtemp, readdir, rm, writeFile } = require('node:fs/promises')
  const { createServer } = require('node:http')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const { createCapabilityStore, loadSdk, startEndpoint } = require('./support.cjs')

  // Own every probe child so a deadline cannot leave native processes behind.
  const children = new Set()
  const spawn = (executable, args, options = {}) => {
    const child = spawnChild(executable, args, { ...options, detached: true })
    children.add(child)
    child.once('close', () => children.delete(child))
    return child
  }
  process.once('exit', () => {
    for (const child of children) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* Already reaped. */
        }
      }
    }
  })

  const CODEX = process.env.SPIKE_CODEX_EXECUTABLE ?? 'codex'
  const deadline = setTimeout(() => {
    console.error('probe_deadline')
    process.exit(1)
  }, 60000)

  // The hardening keys of intake-server/src/agents/codex.ts (CODEX_CONFIG), plus the
  // `features.goals` switch the `/2` profile adds to drop the built-in goal tools.
  const HARDENING = {
    'features.goals': false,
    approval_policy: 'never',
    sandbox_mode: 'read-only',
    web_search: 'disabled',
    'features.shell_tool': false,
    'features.view_image': false,
    'features.apps': false,
    'features.plugins': false,
    'features.remote_plugin': false,
    'features.memories': false,
    'features.multi_agent': false,
    'features.request_permissions_tool': false,
    'skills.bundled.enabled': false,
    'history.persistence': 'none',
    forced_login_method: 'api',
  }

  function sse(res, events) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    let sequence = 0
    for (const event of events) {
      res.write(
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: sequence++ })}\n\n`,
      )
    }
    res.end()
  }

  function responseEvents(id, item) {
    const response = {
      id,
      object: 'response',
      status: 'in_progress',
      output: [],
      model: 'stub-model',
    }
    return [
      { type: 'response.created', response },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      {
        type: 'response.completed',
        response: {
          ...response,
          status: 'completed',
          output: [item],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ]
  }

  const inputText = (item) =>
    (Array.isArray(item.content) ? item.content : []).map((part) => part.text ?? '').join(' ')

  async function startStub({ delayFirstMs = 0 } = {}) {
    const requests = []
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', async () => {
        if (!req.url.includes('/responses')) {
          res.writeHead(404).end()
          return
        }
        const body = JSON.parse(raw || '{}')
        const input = body.input ?? []
        const toolNames = (body.tools ?? []).map((tool) => tool.name ?? tool.type).sort()
        const namespaceTool = (body.tools ?? []).find(
          (tool) => tool.type === 'namespace' && tool.name === 'mcp__intake',
        )
        const statusTool = namespaceTool ? 'status' : undefined
        const forced = process.env.SPIKE_CALL_TOOL
        const hasOutput = input.at(-1)?.type === 'function_call_output'
        requests.push({
          plantedSkillVisible: JSON.stringify(body).includes('INTAKE-PLANTED-SKILL'),
          authKind:
            req.headers.authorization === 'Bearer sk-spike-fake'
              ? 'fake-api-key'
              : req.headers.authorization
                ? 'other-bearer'
                : 'none',
          tools: toolNames,
          shape: input.map((item) =>
            item.type === 'message'
              ? `${item.role}:${inputText(item).replace(/\s+/g, ' ').slice(0, 60)}`
              : item.type === 'function_call_output'
                ? `function_call_output:${(typeof item.output === 'string' ? item.output : JSON.stringify(item.output)).slice(0, 220)}`
                : item.type === 'function_call'
                  ? `function_call:${item.name}`
                  : item.type,
          ),
        })
        if (requests.length === 1 && process.env.SPIKE_TOOLS_DUMP)
          (await import('node:fs')).writeFileSync(
            process.env.SPIKE_TOOLS_DUMP,
            JSON.stringify(body.tools, null, 1),
          )
        if (requests.length === 1 && delayFirstMs)
          await new Promise((r) => setTimeout(r, delayFirstMs))
        const id = `resp_${requests.length}`
        if (!hasOutput && statusTool) {
          const call =
            forced === 'request_user_input'
              ? {
                  name: 'request_user_input',
                  arguments: JSON.stringify({
                    questions: [
                      {
                        id: 'q1',
                        header: 'Value',
                        question: 'Which value?',
                        options: [
                          { label: '1k', description: 'one kilo-ohm' },
                          { label: '10k', description: 'ten kilo-ohm' },
                        ],
                      },
                    ],
                  }),
                }
              : {
                  name: statusTool,
                  namespace: 'mcp__intake',
                  arguments: JSON.stringify({ text: 'Reading the label' }),
                }
          sse(
            res,
            responseEvents(id, {
              type: 'function_call',
              id: `fc_${requests.length}`,
              call_id: `call_${requests.length}`,
              status: 'completed',
              ...call,
            }),
          )
        } else {
          sse(
            res,
            responseEvents(id, {
              type: 'message',
              id: `msg_${requests.length}`,
              role: 'assistant',
              status: 'completed',
              content: [
                { type: 'output_text', text: `done after ${input.length} items`, annotations: [] },
              ],
            }),
          )
        }
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server, requests, url: `http://127.0.0.1:${server.address().port}` }
  }

  function startAppServer({ home, stubUrl, mcpUrl, capability }) {
    const config = {
      ...HARDENING,
      ...JSON.parse(process.env.SPIKE_EXTRA_CONFIG ?? '{}'),
      model_provider: 'spike',
    }
    const args = ['app-server', '--listen', 'stdio://', '--strict-config']
    for (const [key, value] of Object.entries(config))
      args.push('-c', `${key}=${JSON.stringify(value)}`)
    args.push(
      '-c',
      `model_providers.spike={name="Spike",base_url="${stubUrl}/v1",env_key="OPENAI_API_KEY",wire_api="responses",requires_openai_auth=false}`,
      '-c',
      `mcp_servers.intake={url="${mcpUrl}",bearer_token_env_var="INTAKE_TOOL_CAPABILITY",default_tools_approval_mode="approve"}`,
    )
    if (process.env.SPIKE_OMIT_CODE_MODE)
      args.push('-c', 'mcp_servers.intake.omit_tools_from=["code_mode"]')
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.SPIKE_PRIVATE_HOME ? join(home, 'private-home') : home,
      CODEX_HOME: join(home, 'codex-home'),
      TMPDIR: home,
      OPENAI_API_KEY: 'sk-spike-fake',
      INTAKE_TOOL_CAPABILITY: capability,
    }
    const child = spawn(CODEX, args, { cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = ''
    let stderr = ''
    const waiters = new Map()
    const notifications = []
    const serverRequests = []
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (!line.trim()) continue
        const message = JSON.parse(line)
        if ('id' in message && 'method' in message) {
          serverRequests.push(message.method)
          child.stdin.write(
            `${JSON.stringify({ id: message.id, error: { code: -32601, message: 'refused by spike' } })}\n`,
          )
        } else if ('id' in message) {
          waiters.get(message.id)?.(message)
          waiters.delete(message.id)
        } else {
          notifications.push(message)
        }
      }
    })
    let sequence = 0
    const request = (method, params) =>
      new Promise((resolve) => {
        const id = ++sequence
        process.stderr.write(`-> ${method}\n`)
        const timer = setTimeout(() => {
          process.stderr.write(`!! timeout ${method}; child stderr: ${stderr.slice(-300)}\n`)
          waiters.delete(id)
          resolve({ error: { message: `timeout waiting for ${method}` } })
        }, 15000)
        waiters.set(id, (message) => {
          clearTimeout(timer)
          process.stderr.write(`<- ${method} ${JSON.stringify(message).slice(0, 300)}\n`)
          resolve(message)
        })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    const notify = (method, params) =>
      child.stdin.write(`${JSON.stringify({ method, ...(params ? { params } : {}) })}\n`)
    const waitFor = async (predicate, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = notifications.find(predicate)
        if (found) return found
        await new Promise((r) => setTimeout(r, 50))
      }
      return undefined
    }
    const close = async () => {
      child.stdin.end()
      child.kill('SIGTERM')
      const exited = new Promise((resolve) => child.on('close', resolve))
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      await exited
      clearTimeout(timer)
    }
    return {
      request,
      notify,
      waitFor,
      notifications,
      serverRequests,
      close,
      stderr: () => stderr.slice(-400),
    }
  }

  const summary = (response) => ('error' in response ? { error: response.error } : response.result)

  const sdk = await loadSdk('v2')
  const capabilities = createCapabilityStore()
  const calls = []
  const capability = capabilities.issue({ sessionId: 'lead-1', stage: 'examine', pendingInbox: 1 })
  const endpoint = await startEndpoint(sdk, capabilities, calls)
  const home = await mkdtemp(join(tmpdir(), 'codex-spike-'))
  await mkdir(join(home, 'codex-home'), { mode: 0o700 })
  await mkdir(join(home, 'private-home'), { mode: 0o700 })
  await mkdir(join(home, '.agents', 'skills', 'probe'), { recursive: true })
  await writeFile(
    join(home, '.agents', 'skills', 'probe', 'SKILL.md'),
    '---\nname: probe\ndescription: INTAKE-PLANTED-SKILL\n---\nINTAKE-PLANTED-SKILL',
  )
  const stub = await startStub({ delayFirstMs: 3000 })
  const version = await new Promise((resolve) => {
    const child = spawn(CODEX, ['--version'])
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.on('close', () => resolve(out.trim()))
  })
  const report = { codexVersion: version, node: process.version }

  try {
    const first = startAppServer({ home, stubUrl: stub.url, mcpUrl: endpoint.url, capability })
    report.initialize = summary(
      await first.request('initialize', {
        clientInfo: { name: 'bench_intake_spike', version: '1' },
        capabilities: { experimentalApi: true },
      }),
    )
    first.notify('initialized')
    const started = await first.request('thread/start', {
      model: 'gpt-spike',
      cwd: home,
      ephemeral: false,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      baseInstructions: 'Spike instructions.',
    })
    const threadId = started.result?.thread?.id
    report.threadStart = {
      threadId,
      model: started.result?.model,
      modelProvider: started.result?.modelProvider,
      approvalPolicy: started.result?.approvalPolicy,
      sandbox: started.result?.sandbox?.type,
      error: started.error,
    }
    const configRead = await first.request('config/read', { includeLayers: false, cwd: home })
    const effective = configRead.result?.config ?? {}
    report.effectiveFeatures = effective.features
    report.effectiveSkills = effective.skills
    report.effectiveMcpServers = {
      names: Object.keys(effective.mcp_servers ?? {}),
      intake: effective.mcp_servers?.intake,
      error: configRead.error,
    }
    const status = await first.request('mcpServerStatus/list', {})
    report.mcpServerStatus = summary(status)

    const turn = await first.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: 'Examine the batch', text_elements: [] }],
    })
    const turnId = turn.result?.turn?.id
    report.turnStart = { turnId, error: turn.error }
    await new Promise((r) => setTimeout(r, 1200))
    const steer = await first.request('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text: 'Operator chat: the reel is 1k ohm', text_elements: [] }],
    })
    report.turnSteer = summary(steer)
    const staleSteer = await first.request('turn/steer', {
      threadId,
      expectedTurnId: 'not-the-active-turn',
      input: [{ type: 'text', text: 'stale', text_elements: [] }],
    })
    report.turnSteerWrongTurnId = summary(staleSteer)
    const completed = await first.waitFor((n) => n.method === 'turn/completed')
    report.turnCompleted = completed?.params?.turn?.status ?? completed?.params ?? 'timeout'
    report.firstProcessServerRequests = first.serverRequests
    report.codexHomeEntries = (await readdir(join(home, 'codex-home'))).sort()
    report.firstProcessStderrTail = first.stderr()
    await first.close()
    report.firstProcessProviderRequests = stub.requests.splice(0)
    report.toolCallsSeenByServer = calls.splice(0).map((call) => `${call.session}:${call.tool}`)

    if (process.env.SPIKE_RESUME_EXTRA_CONFIG)
      process.env.SPIKE_EXTRA_CONFIG = process.env.SPIKE_RESUME_EXTRA_CONFIG
    const second = startAppServer({ home, stubUrl: stub.url, mcpUrl: endpoint.url, capability })
    await second.request('initialize', {
      clientInfo: { name: 'bench_intake_spike', version: '1' },
      capabilities: { experimentalApi: true },
    })
    second.notify('initialized')
    const resumed = await second.request('thread/resume', { threadId, excludeTurns: true })
    report.threadResume = {
      threadId: resumed.result?.thread?.id,
      model: resumed.result?.model,
      error: resumed.error,
    }
    const resumedTurn = await second.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: 'Answer: it is a BC547', text_elements: [] }],
    })
    report.resumedTurnStart = { turnId: resumedTurn.result?.turn?.id, error: resumedTurn.error }
    const resumedDone = await second.waitFor((n) => n.method === 'turn/completed')
    report.resumedTurnCompleted = resumedDone?.params?.turn?.status ?? 'timeout'
    await second.close()
    report.resumedProviderRequests = stub.requests.splice(0)
    report.resumedToolCalls = calls.splice(0).map((call) => `${call.session}:${call.tool}`)
  } catch (error) {
    report.error = String(error?.stack ?? error).slice(0, 600)
  } finally {
    stub.server.close()
    await endpoint.app.close()
    await rm(home, { recursive: true, force: true })
  }
  clearTimeout(deadline)
  console.log(JSON.stringify(report, null, 2))

  if (
    report.error ||
    report.mcpServerStatus?.error ||
    report.turnCompleted !== 'completed' ||
    report.resumedTurnCompleted !== 'completed' ||
    !report.toolCallsSeenByServer?.includes('lead-1:status') ||
    !report.resumedToolCalls?.includes('lead-1:status')
  ) {
    process.exitCode = 1
  }
}
main().catch(() => {
  console.error('probe_failed')
  process.exit(1)
})

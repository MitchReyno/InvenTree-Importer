// Deterministic protocol executable. Never imports a provider SDK or makes a network request.
const readline = require('node:readline')
const fs = require('node:fs')
const mode = process.argv[2] === '--stub-mode' ? process.argv[3] : 'success'
const args = process.argv.slice(2)
if (mode === 'no-read') {
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 1000)
} else if (args.includes('auth')) {
  process.stdout.write(
    JSON.stringify(
      { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' },
      null,
      2,
    ) + '\n',
  )
} else {
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
  const output = (text) => {
    const input = JSON.parse(text)
    if (mode === 'question' || !input.inspected_sources.length) {
      return {
        proposal: null,
        question: {
          kind: 'clarification',
          subject_id: input.subject_id,
          prompt: 'Read the marking?',
          reason: 'Insufficient evidence.',
        },
      }
    }
    return {
      question: null,
      proposal: {
        schema_version: 'bench-intake-proposal/2',
        subject_id: input.subject_id,
        summary: 'Controlled source-bound suggestion.',
        sources: [
          input.inspected_sources.find((source) => source.kind === 'media_version') ??
            input.inspected_sources[0],
        ],
      },
    }
  }
  const lines = readline.createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    const frame = JSON.parse(line)
    if (frame.method === 'initialize') {
      send({ id: frame.id, result: {} })
    }
    if (frame.method === 'account/read') {
      send({ id: frame.id, result: { account: { type: 'chatgpt' } } })
    }
    if (frame.method === 'thread/start') {
      send({
        id: frame.id,
        result: {
          thread: { id: 'stub-thread' },
          modelProvider: args.some((arg) => arg.includes('model_provider="bench_openai"'))
            ? 'bench_openai'
            : 'openai',
          model: frame.params.model,
          approvalPolicy: 'never',
          sandbox: { type: 'readOnly' },
        },
      })
    }
    const codex = frame.method === 'turn/start'
    const claude = frame.type === 'user'
    if (!codex && !claude) {
      return
    }
    if (mode === 'hang') {
      fs.writeFileSync(
        require('node:path').join(process.cwd(), 'stub-hang-ready'),
        String(process.pid),
      )
      process.on('SIGTERM', () => {})
      setInterval(() => {}, 1000)
      return
    }
    if (mode === 'malformed') {
      process.stdout.write('{bad\n')
      return
    }
    if (mode === 'oversize') {
      process.stdout.write('x'.repeat(300000) + '\n')
      return
    }
    const text = codex ? frame.params.input[0].text : frame.message.content[0].text
    const context = JSON.parse(text)
    const delivered = codex ? frame.params.input.slice(1) : frame.message.content.slice(1)
    const expected = context.image_order ?? []
    if (delivered.length !== expected.length) {
      process.exit(87)
    }
    for (let index = 0; index < delivered.length; index++) {
      const base64 = codex ? delivered[index].url.split(',')[1] : delivered[index].source.data
      if (
        require('node:crypto')
          .createHash('sha256')
          .update(Buffer.from(base64, 'base64'))
          .digest('hex') !== expected[index].sha256
      ) {
        process.exit(88)
      }
    }
    const result = output(text)
    if (codex) {
      send({ id: frame.id, result: { turn: { id: 'stub-turn' } } })
      if (mode === 'started_tool') {
        send({
          method: 'item/started',
          params: {
            threadId: 'stub-thread',
            turnId: 'stub-turn',
            item: { type: 'commandExecution' },
          },
        })
        return
      }
      if (mode === 'tool') {
        send({ id: 999, method: 'item/commandExecution/requestApproval', params: {} })
        return
      }
      send({
        method: 'item/completed',
        params: {
          threadId: 'stub-thread',
          turnId: 'stub-turn',
          item: { type: 'agentMessage', text: JSON.stringify(result) },
        },
      })
      send({
        method: 'turn/completed',
        params: { threadId: 'stub-thread', turn: { id: 'stub-turn', status: 'completed' } },
      })
    } else {
      const session = args[args.indexOf('--session-id') + 1]
      send({
        type: 'system',
        subtype: 'init',
        session_id: session,
        model: args[args.indexOf('--model') + 1],
        tools: mode === 'tool' ? ['Bash'] : [],
      })
      send({
        type: 'result',
        subtype: 'success',
        session_id: session,
        is_error: false,
        structured_output: result,
      })
    }
  })
}

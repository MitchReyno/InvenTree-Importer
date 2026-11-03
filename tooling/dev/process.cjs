const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

function launch(name, command, args, options, ready) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let text = ''
  let error
  const exited = new Promise((resolve) => {
    child.once('error', () => {
      error = new Error(`${name}_unavailable`)
    })
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (bytes) => {
      process.stdout.write(`[${name}] ${bytes}`)
      text = (text + bytes.toString()).slice(-16384)
    })
  }
  return {
    name,
    child,
    exited,
    async ready(timeoutMs = 30000, signal) {
      const deadline = Date.now() + timeoutMs
      while (true) {
        signal?.throwIfAborted()
        if (error || child.exitCode !== null || child.signalCode !== null) {
          throw error ?? new Error(`${name}_stopped`)
        }
        if (ready(text)) {
          return
        }
        if (Date.now() >= deadline) {
          throw new Error(`${name}_startup_timeout`)
        }
        await delay(30)
      }
    },
  }
}

async function stop(children, graceMs = 45000) {
  for (const item of children) {
    if (item.child.exitCode === null && item.child.signalCode === null) {
      item.child.kill('SIGTERM')
    }
  }
  let timer
  let result
  try {
    result = await Promise.race([
      Promise.all(children.map((item) => item.exited)).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), graceMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }

  if (!result) {
    throw new Error('owned_app_shutdown_unconfirmed')
  }
}

/** A ready sibling that exits must invalidate the entire in-progress startup. */
function startupGroup(signal) {
  const failure = new AbortController()
  const combined = AbortSignal.any([failure.signal, ...(signal ? [signal] : [])])
  const children = []
  return {
    watch(item) {
      children.push(item)
      void item.exited.then(() => failure.abort(new Error(`${item.name}_stopped_during_startup`)))
      return { ...item, ready: (timeoutMs) => item.ready(timeoutMs, combined) }
    },

    confirm() {
      combined.throwIfAborted()
      for (const item of children) {
        if (item.child.exitCode !== null || item.child.signalCode !== null) {
          throw new Error(`${item.name}_stopped_during_startup`)
        }
      }
    },
  }
}
module.exports = { launch, stop, startupGroup }

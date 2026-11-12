const { spawnSync } = require('node:child_process')

const SESSION_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
const PARENT_POLL_MS = 1000

function parentOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'ppid='], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C' },
  })
  if (result.error || result.status !== 0) return null
  const value = Number(result.stdout.trim())
  return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * Stop the supervisor when the terminal closes or the launching process exits.
 * A failed parent lookup does not stop the session.
 */
function bindSessionEnd(onStop, options = {}) {
  const signals = options.signals ?? SESSION_SIGNALS
  const lookup = options.lookup ?? parentOf
  const intervalMs = options.intervalMs ?? PARENT_POLL_MS
  const parentPid = options.parentPid === undefined ? lookup(process.pid) : options.parentPid
  let ended = false
  let timer = null
  const stop = () => {
    if (ended) return
    ended = true
    if (timer) clearInterval(timer)
    onStop()
  }
  for (const signal of signals) {
    process.on(signal, stop)
  }
  if (parentPid !== null) {
    timer = setInterval(() => {
      if (ended) return
      const current = lookup(process.pid)
      if (current === null || current === parentPid) return
      stop()
    }, intervalMs)
  }
  return {
    close() {
      ended = true
      if (timer) clearInterval(timer)
      for (const signal of signals) {
        process.removeListener(signal, stop)
      }
    },
  }
}

module.exports = { bindSessionEnd, parentOf }

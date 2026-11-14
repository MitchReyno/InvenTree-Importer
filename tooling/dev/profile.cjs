const SESSION_PROFILES = new Set([
  'synthetic-session/1',
  'native-agent/2',
  'shared-vm-agent/1',
  'shared-vm-agent/2',
])

/** The agent worker for this profile, or null when the synthetic Processing child runs instead. */
function processingWorker(profile) {
  if (SESSION_PROFILES.has(profile)) {
    return {
      entry: 'src/agents/session/session-worker-main.ts',
      ready: 'session supervisor ready',
    }
  }
  if (profile === 'native-agent/1') {
    return {
      entry: 'src/agents/worker-main.ts',
      ready: 'native agent supervisor ready',
    }
  }
  return null
}

module.exports = { processingWorker }

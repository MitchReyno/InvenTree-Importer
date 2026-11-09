const DEVELOPMENT_PROFILES = [
  'synthetic-research/2',
  'native-agent/1',
  'native-agent/2',
  'shared-vm-agent/1',
]

function developmentProfile(settings) {
  const profile = settings.INTAKE_PROCESSING_PROFILE ?? 'synthetic-research/2'
  if (!DEVELOPMENT_PROFILES.includes(profile)) {
    throw new Error('unsupported_development_profile')
  }
  return profile
}

/** The native worker for this profile, or null when the synthetic Processing child runs instead. */
function processingWorker(profile) {
  if (profile === 'native-agent/2' || profile === 'shared-vm-agent/1') {
    return {
      entry: 'src/agents/session-worker-main.ts',
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

module.exports = { developmentProfile, processingWorker }

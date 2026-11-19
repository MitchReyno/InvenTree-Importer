const { join } = require('node:path')
const { agentWorkerSettings } = require('./settings.cjs')

/**
 * Orders what must exist before the supervisor picks a state root: the database
 * server (and, for local-inventree, the whole local stack), then the identity
 * the root is scoped to.
 */
async function prepareDevelopment(settings, target, deps) {
  if (target.kind === 'local-inventree') {
    // `inventree:dev up` starts the shared database itself, then InvenTree.
    await deps.startLocalInventree()
  } else if (!settings.INTAKE_DEV_ADMIN_URL) {
    await deps.startServices()
  }
  const serverId = await deps.serverIdentity(settings)
  const local =
    target.kind === 'local-inventree' ? await deps.readLocalInventree(settings) : undefined
  const scope = local ? { serverId, instanceId: local.instanceId } : { serverId }
  return { serverId, scope, key: local?.readToken, root: deps.stateRoot(settings, target, scope) }
}

/**
 * The read target the API child is given; only fake (v1) state carries its own runner profile.
 * Without a deployment ID the API cannot authorize an effect, which keeps a read-only mock read-only.
 */
function apiTargetEnv(target, state, key, { readOnly } = {}) {
  // Required: a dropped flag must fail rather than quietly grant the mock its deployment.
  if (typeof readOnly !== 'boolean') {
    throw new Error('read_only_decision_required')
  }
  if (state.version === 1) {
    return {
      INTAKE_CREDENTIAL_REF: 'owned_development',
      INTAKE_DEV_API_KEY: state.runnerConfig.profile.credential,
      INTAKE_READ_ORIGIN: state.runnerConfig.profile.origin,
      ...(readOnly ? {} : { INTAKE_DEPLOYMENT_ID: state.runnerConfig.deploymentId }),
    }
  }
  return {
    INTAKE_CREDENTIAL_REF: target.credentialRef,
    INTAKE_DEV_API_KEY: key,
    INTAKE_READ_ORIGIN: target.origin,
  }
}

/**
 * The agent worker's whole environment: provider and VM settings, the origins its VM egress
 * protects, its profile, state root and databases. The protected origins come straight from
 * the launcher's own values: the app's public origin, its tailnet identity when it has one,
 * and the inventory origin in the target environment. Its own app origin is not passed.
 */
function agentChildEnvironment({
  resolved,
  settings,
  profile,
  root,
  state,
  writerUrl,
  publicOrigin,
  tailnet,
  targetEnv,
}) {
  const origins = {
    appOrigin: publicOrigin,
    tailnetOrigin: tailnet ? tailnet.origin : undefined,
    inventoryOrigin: targetEnv.INTAKE_READ_ORIGIN,
  }
  return {
    ...agentWorkerSettings(resolved, settings, origins),
    INTAKE_PROCESSING_PROFILE: profile,
    INTAKE_AGENT_STATE_ROOT: join(root, 'agents'),
    INTAKE_AGENT_DATABASE_URL: state.processingUrl,
    INTAKE_AGENT_SCHEDULER_DATABASE_URL:
      state.version === 1 ? state.runnerConfig.schedulerDatabaseUrl : state.schedulerUrl,
    ...(writerUrl ? { INTAKE_AGENT_WRITER_DATABASE_URL: writerUrl } : {}),
  }
}

/** Only a writable mock runs the owned apply runner; local and external targets never do. */
function startsApplyRunner(state, readOnly) {
  if (typeof readOnly !== 'boolean') {
    throw new Error('read_only_decision_required')
  }
  return state.version === 1 && !readOnly
}

/** Children share the supervisor's resolved state directory and never re-read an env file. */
function serviceEnvironment(baseEnv, settings, stateDirectory) {
  return { ...baseEnv, INTAKE_DEV_STATE: stateDirectory(settings), INTAKE_ENV_FILE: '' }
}

/** Under the supervisor lock, the local instance must still be the one the root was chosen for. */
async function confirmLocalInventree(settings, target, prepared, readLocalInventree) {
  if (target.kind !== 'local-inventree') return
  const current = await readLocalInventree(settings)
  if (current.instanceId !== prepared.scope.instanceId || current.readToken !== prepared.key) {
    throw new Error('local_inventree_changed_during_startup')
  }
}

/**
 * The supervisor's startup order: services with the shared child env, the scoped state root,
 * its lock, then a re-check that the local instance did not change before the lock was held.
 */
async function startSupervision(settings, target, deps) {
  const serviceEnv = serviceEnvironment(deps.baseEnv, settings, deps.stateDirectory)
  const prepared = await prepareDevelopment(settings, target, {
    startServices: () => deps.startServices(serviceEnv),
    startLocalInventree: () => deps.startLocalInventree(serviceEnv),
    serverIdentity: deps.serverIdentity,
    readLocalInventree: deps.readLocalInventree,
    stateRoot: deps.stateRoot,
  })
  const release = await deps.privateState(prepared.root)
  try {
    await confirmLocalInventree(settings, target, prepared, deps.readLocalInventree)
  } catch (error) {
    await release()
    throw error
  }
  return { serviceEnv, prepared, release }
}

module.exports = {
  agentChildEnvironment,
  prepareDevelopment,
  apiTargetEnv,
  startsApplyRunner,
  serviceEnvironment,
  confirmLocalInventree,
  startSupervision,
}

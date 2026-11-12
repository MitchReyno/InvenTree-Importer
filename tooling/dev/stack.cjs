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
function apiTargetEnv(target, state, key, { readOnly = false } = {}) {
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
  prepareDevelopment,
  apiTargetEnv,
  serviceEnvironment,
  confirmLocalInventree,
  startSupervision,
}

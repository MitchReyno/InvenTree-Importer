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

/** The read target the API child is given; only fake (v1) state carries its own runner profile. */
function apiTargetEnv(target, state, key) {
  if (state.version === 1) {
    return {
      INTAKE_CREDENTIAL_REF: 'owned_development',
      INTAKE_DEV_API_KEY: state.runnerConfig.profile.credential,
      INTAKE_READ_ORIGIN: state.runnerConfig.profile.origin,
      INTAKE_DEPLOYMENT_ID: state.runnerConfig.deploymentId,
    }
  }
  return {
    INTAKE_CREDENTIAL_REF: target.credentialRef,
    INTAKE_DEV_API_KEY: key,
    INTAKE_READ_ORIGIN: target.origin,
  }
}

module.exports = { prepareDevelopment, apiTargetEnv }

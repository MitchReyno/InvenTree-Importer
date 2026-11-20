/**
 * `pnpm vm:setup` prepares the agent VM in one rerunnable command, and `pnpm dev` keeps its runner
 * image current. Both use the checks and steps in `vm-provision.cjs`, so they agree on "current".
 */
const { constants } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  confirmVmChildren,
  ensureVmRunning,
  finishVm,
  resolveGuestDir,
  runCommand,
  startVmChildren,
} = require('./vm.cjs')
const {
  VmSetupError,
  browserPolicyCurrent,
  buildImages,
  checkOperatorKey,
  checkPairing,
  checkPrerequisites,
  checkRunnerTag,
  ensureBrowserPolicy,
  ensureGuestServices,
  ensureOperatorKey,
  ensurePairing,
  ensureVm,
  guestImageDigest,
  loadRunner,
  localImageDigest,
  servicesState,
  sourceDigest,
} = require('./vm-provision.cjs')

/** The operator key file's name in the development state directory. */
const VM_OPERATOR_KEY_FILE = 'vm-operator-key'

const STANDARD_WRITE = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}

/** Codes that already say what went wrong; any other failure is reported by its step. */
const NAMED_FAILURES = new Set([
  'vm_setup_prerequisite_missing',
  'vm_pairing_mismatch',
  'vm_operator_key_mismatch',
  'vm_guest_service_start_failed',
  'vm_guest_service_provision_failed',
  'vm_guest_service_conflict',
  'vm_runner_image_name_reserved',
  'vm_setup_cancelled',
])

/**
 * Runs one step, reports whether it changed anything, and names the step when it fails. A
 * cancelled run stops before the next step, so the cleanup after it still runs.
 */
async function step(name, write, action, signal) {
  if (signal?.aborted) {
    throw new VmSetupError('vm_setup_cancelled', name)
  }
  let result
  try {
    result = await action()
  } catch (error) {
    if (error instanceof VmSetupError && NAMED_FAILURES.has(error.code)) {
      throw error
    }
    throw new VmSetupError('vm_setup_step_failed', name, { cause: error })
  }
  write.out(result === 'done' ? `${name}: already done\n` : `${name}: done\n`)
  return result
}

/** Builds the images unless the local runner image already carries the current digest. */
async function ensureImages(context) {
  if ((await localImageDigest(context, context.plan.image)) === context.digest) {
    return 'done'
  }
  context.write.out('Building the app, guest and runner images; this takes a few minutes.\n')
  await buildImages(context)
  return 'changed'
}

async function ensureRunnerLoaded(context) {
  if ((await guestImageDigest(context)) === context.digest) {
    return 'done'
  }
  await loadRunner(context)
  return 'changed'
}

/**
 * The pairing and key are checked before anything is built or written, so a mismatch stops the
 * run with nothing changed.
 */
async function checkIdentity(context) {
  await checkPairing(context)
  await checkOperatorKey(context)
  return 'done'
}

/** The steps after the VM is running, in order. */
async function provisionGuest(context) {
  const { write, signal } = context
  await step('Pairing and operator key checks', write, () => checkIdentity(context), signal)
  await step('Images', write, () => ensureImages(context), signal)
  await step('Runner image in the VM', write, () => ensureRunnerLoaded(context), signal)
  await step('Pairing', write, () => ensurePairing(context), signal)
  await step('Operator key', write, () => ensureOperatorKey(context), signal)
  await step('Browser policy', write, () => ensureBrowserPolicy(context), signal)
  await step('Guest services', write, () => ensureGuestServices(context), signal)
}

function nextSteps(plan) {
  return [
    '',
    `VM ${plan.name} is ready. To use it, set these in .env and restart pnpm dev:`,
    '',
    '  INTAKE_USE_MOCK_AI_AGENTS=false',
    '  INTAKE_RUN_AGENTS_IN_VM=true',
    '',
    `Then sign in under Settings › Agents with the operator key in ${plan.keyFile},`,
    `as the README's "VM agent runner" section describes.`,
    '',
  ].join('\n')
}

/**
 * The whole setup. The VM is stopped at the end only if this run started it and it isn't kept,
 * including after a failed step.
 */
async function runVmSetup({
  plan,
  repository,
  origin,
  keyFile,
  exec = runCommand,
  env,
  write = STANDARD_WRITE,
  signal,
  settleMs,
}) {
  const context = { plan, repository, origin, keyFile, exec, env, write, signal, settleMs }
  checkRunnerTag(plan)
  await checkPrerequisites({ exec, env })
  context.digest = await sourceDigest(repository, { exec })
  let booted = false
  context.onBoot = () => {
    booted = true
  }
  let failure = null
  try {
    await step('VM', write, async () => ((await ensureVm(context)) ? 'changed' : 'done'), signal)
    context.guestDir = await resolveGuestDir(plan, { exec, env, write })
    await provisionGuest(context)
  } catch (error) {
    failure = error
  }
  // The VM is stopped after a failure too; a failed stop is a failed run.
  const stopped = await finishVm(plan, booted, { exec, env, write })
  if (failure) {
    throw failure
  }
  if (!stopped) {
    throw new VmSetupError('vm_stop_failed', plan.name)
  }
  write.out(nextSteps({ ...plan, keyFile }))
}

/**
 * Before `pnpm dev` starts the relays: checks the guest image, the services and the browser
 * policy, and runs only the steps still needed. Resolves true when it refreshed anything.
 */
async function refreshRunner({
  plan,
  guestDir,
  repository,
  origin,
  keyFile,
  exec = runCommand,
  env,
  write = STANDARD_WRITE,
  settleMs,
}) {
  const context = { plan, guestDir, repository, origin, keyFile, exec, env, write, settleMs }
  checkRunnerTag(plan)
  // A pairing that doesn't match its guest would never authenticate; nothing starts on it.
  await checkPairing(context)
  context.digest = await sourceDigest(repository, { exec })
  const imageCurrent = (await guestImageDigest(context)) === context.digest
  const policyCurrent = !plan.tools || (await browserPolicyCurrent(context))
  const services = await servicesState(context)
  const servicesCurrent = Object.values(services).every(({ state }) => state === 'current')
  if (imageCurrent && policyCurrent && servicesCurrent) {
    return false
  }
  // A key mismatch stops the refresh before anything is built, loaded or reprovisioned.
  await checkOperatorKey(context)
  if (!imageCurrent) {
    write.out(`Refreshing the runner image in VM ${plan.name}.\n`)
    try {
      if ((await localImageDigest(context, plan.image)) !== context.digest) {
        await buildImages(context)
      }
      await loadRunner(context)
    } catch (error) {
      throw new VmSetupError('vm_runner_image_refresh_failed', plan.image, { cause: error })
    }
  }
  if (!policyCurrent) {
    try {
      await ensureBrowserPolicy(context)
    } catch (error) {
      throw new VmSetupError('vm_setup_step_failed', `browser policy in ${plan.name}:${guestDir}`, {
        cause: error,
      })
    }
  }
  // Checks the operator key before reprovisioning, and starts stopped services.
  await ensureGuestServices(context)
  return true
}

/**
 * The launcher's VM side, in order: boot (recorded through `onBoot` before it starts, so the
 * launcher's shutdown stops a VM this run booted even after a failure), the guest directory, the
 * runner refresh, then the tunnel and relays. A failed refresh starts no relay.
 */
async function startManagedVm(plan, options) {
  const {
    onBoot,
    onRefreshed,
    signal,
    env,
    repository,
    origin,
    keyFile,
    launch,
    execPath,
    steps = {},
  } = options
  const {
    ensureRunning = ensureVmRunning,
    guestDirectory = resolveGuestDir,
    refresh = refreshRunner,
    startChildren = startVmChildren,
    confirmChildren = confirmVmChildren,
  } = steps
  await ensureRunning(plan, { signal, env, onBoot })
  signal?.throwIfAborted()
  const guestDir = await guestDirectory(plan, { env, signal })
  signal?.throwIfAborted()
  if (await refresh({ plan, guestDir, repository, origin, keyFile, env })) {
    onRefreshed?.()
  }
  signal?.throwIfAborted()
  const children = startChildren(
    { ...plan, guestDir },
    { launch, execPath, repository, baseEnv: env },
  )
  return { children, confirmed: confirmChildren(children, { signal }) }
}

/** With the VM unmanaged, only the local image is compared, so the VM is never touched. */
async function staleImageWarning({ plan, repository, exec = runCommand, env }) {
  const digest = await sourceDigest(repository, { exec })
  if ((await localImageDigest({ exec, env }, plan.image)) === digest) {
    return null
  }
  return `The runner image ${plan.image} is older than this checkout; run pnpm vm:setup to refresh it.\n`
}

/** Explains a setup failure in one line, naming what it concerns. */
function failureLine(error) {
  if (!(error instanceof VmSetupError)) {
    return error?.message ?? String(error)
  }
  const detail = Array.isArray(error.detail) ? error.detail.join(' and ') : error.detail
  return detail ? `${error.code}: ${detail}` : error.code
}

/** The browser origin `pnpm dev` serves, which the guest management services are bound to. */
async function developmentOrigin(settings, env) {
  const { readTailnetIdentity, tailscaleOption } = require('./tailnet.cjs')
  const tailscale = tailscaleOption(settings, [])
  if (tailscale) {
    return (await readTailnetIdentity('tailscale', tailscale.port, env)).origin
  }
  return `http://127.0.0.1:${Number(settings.INTAKE_DEV_PORT || 4330)}`
}

async function main() {
  const repository = resolve(__dirname, '../..')
  const env = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'TMPDIR',
      'LANG',
      'LIMA_HOME',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  )
  const { developmentEnvironment } = require('./environment.cjs')
  const { resolveVmSetup } = require('./settings.cjs')
  const settings = await developmentEnvironment(repository)
  const { stateDirectory } = await import(
    pathToFileURL(join(repository, 'intake-server/src/dev/pg-identity.ts')).href
  )
  const state = stateDirectory(settings)
  const plan = resolveVmSetup(settings, { stateDirectory: state })
  const origin = await developmentOrigin(settings, env)
  // Steps run in their own process groups, so a Ctrl-C reaches only this process: the first one
  // stops the run after the current step and still stops a VM it started; the next quits at once.
  const cancel = new AbortController()
  const stop = (name) => {
    if (cancel.signal.aborted) {
      process.exit(128 + constants.signals[name])
    }
    process.stderr.write('Stopping after the current step; press Ctrl-C again to quit at once.\n')
    cancel.abort()
  }
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(name, stop)
  }
  await runVmSetup({
    plan,
    repository,
    origin,
    keyFile: join(state, VM_OPERATOR_KEY_FILE),
    env,
    signal: cancel.signal,
  })
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${failureLine(error)}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  runVmSetup,
  refreshRunner,
  startManagedVm,
  staleImageWarning,
  VM_OPERATOR_KEY_FILE,
  failureLine,
  VmSetupError,
}

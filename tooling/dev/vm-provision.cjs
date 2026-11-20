/**
 * Prepares the agent VM: the checks and steps `pnpm vm:setup` runs in full and `pnpm dev` runs to
 * keep the runner image current. Each step checks before it acts, so a rerun changes nothing that
 * is already in place. Commands are passed in, so tests can substitute them.
 */
const { createHash, randomBytes } = require('node:crypto')
const { lstat: fsLstat, mkdir, readFile, writeFile } = require('node:fs/promises')
const { dirname, join } = require('node:path')
const { DIGEST_LABEL, sourceDigest } = require('./runner-digest.cjs')
const { runCommand } = require('./vm.cjs')

/** Local tags for the two images the runner is built from. */
const APP_IMAGE = 'bench-intake-app:dev'
const GUEST_IMAGE = 'bench-intake-personal-guest:dev'
const PLATFORM = 'linux/arm64'

const IMAGE_BUILD_TIMEOUT_MS = 30 * 60_000
const IMAGE_LOAD_TIMEOUT_MS = 10 * 60_000
/** Creating a VM downloads its base image, so it gets longer than a boot. */
const VM_CREATE_TIMEOUT_MS = 20 * 60_000
const VM_BOOT_TIMEOUT_MS = 180_000
const GUEST_COMMAND_TIMEOUT_MS = 60_000
const PROVISION_TIMEOUT_MS = 5 * 60_000

/** The pairing files the host side holds. */
const PAIRING_FILES = ['ca.pem', 'cert.pem', 'key.pem']

/** Each provider's guest containers, which its provisioning script replaces together. */
const GUEST_SERVICES = {
  claude: {
    script: 'tooling/deployment/bridge/personal-claude.sh',
    containers: ['bench-claude-egress', 'bench-claude-management'],
  },
  codex: {
    script: 'tooling/deployment/bridge/personal-codex.sh',
    containers: ['bench-codex-egress', 'bench-codex-management'],
  },
}
/** Management services serve the operator's browser, so they are bound to its origin. */
const MANAGEMENT_CONTAINERS = new Set(['bench-claude-management', 'bench-codex-management'])
/** The document reader the guest ran before web access moved to the turn's egress. */
const RETIRED_CONTAINER = 'bench-public-reader'

const BROWSER_POLICY = 'tooling/deployment/guest/browser-seccomp.json'

/** A setup failure with its code and what it concerns: a step, a tool, a service or paths. */
class VmSetupError extends Error {
  constructor(code, detail, options) {
    super(code, options)
    this.code = code
    this.detail = detail
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/** The context every step reads: the VM plan, where things are, and how to run commands. */
function guestCommand(context, args, timeout = GUEST_COMMAND_TIMEOUT_MS) {
  const { exec = runCommand, plan, env } = context
  return exec('limactl', ['shell', '--workdir=/', plan.name, ...args], { timeout, env })
}

/** Resolves false when the guest command fails, for checks whose failure means "absent". */
async function guestSucceeds(context, args) {
  try {
    await guestCommand(context, args)
    return true
  } catch {
    return false
  }
}

/** A guest file's SHA-256, or null when it is missing or empty. */
async function guestFileHash(context, path) {
  const output = await guestCommand(context, [
    'sudo',
    'sh',
    '-c',
    'if test -s "$1"; then sha256sum < "$1"; else echo missing; fi',
    'sh',
    path,
  ])
  const value = output.trim().split(/\s+/)[0]
  return value === 'missing' ? null : value
}

/** Refuses before anything changes when `limactl` or `docker` is not on `PATH`. */
async function checkPrerequisites({ exec = runCommand, env } = {}) {
  for (const tool of ['limactl', 'docker']) {
    try {
      await exec('sh', ['-c', 'command -v "$1"', 'sh', tool], { timeout: 10_000, env })
    } catch {
      throw new VmSetupError('vm_setup_prerequisite_missing', tool)
    }
  }
}

/** A local image's digest label, or null when the image or label is missing. */
async function localImageDigest(context, image) {
  const { exec = runCommand, env } = context
  let output
  try {
    output = await exec(
      'docker',
      ['image', 'inspect', '--format', `{{index .Config.Labels "${DIGEST_LABEL}"}}`, image],
      { timeout: GUEST_COMMAND_TIMEOUT_MS, env },
    )
  } catch {
    return null
  }
  const value = output.trim()
  return value && value !== '<no value>' ? value : null
}

/** The guest's runner image digest label, or null when it has no such image. */
async function guestImageDigest(context) {
  let output
  try {
    output = await guestCommand(context, [
      'sudo',
      'docker',
      'image',
      'inspect',
      '--format',
      `{{index .Config.Labels "${DIGEST_LABEL}"}}`,
      context.plan.image,
    ])
  } catch {
    return null
  }
  const value = output.trim()
  return value && value !== '<no value>' ? value : null
}

/** Builds the app, guest and runner images, each labelled with the source digest. */
async function buildImages(context) {
  const { exec = runCommand, env, repository, plan, digest, write } = context
  const label = ['--label', `${DIGEST_LABEL}=${digest}`]
  const options = { timeout: IMAGE_BUILD_TIMEOUT_MS, env, stderr: buildMessages(write) }
  const images = 'tooling/deployment/images'
  await exec(
    'docker',
    [
      'buildx',
      'build',
      '--load',
      '--platform',
      PLATFORM,
      '-f',
      join(repository, images, 'app.Dockerfile'),
      '-t',
      APP_IMAGE,
      ...label,
      repository,
    ],
    options,
  )
  await exec(
    'docker',
    [
      'buildx',
      'build',
      '--load',
      '--platform',
      PLATFORM,
      '-t',
      GUEST_IMAGE,
      ...label,
      join(repository, 'tooling/deployment/guest'),
    ],
    options,
  )
  await exec(
    'docker',
    [
      'build',
      '--platform',
      PLATFORM,
      '--build-arg',
      `APP_IMAGE=${APP_IMAGE}`,
      '--build-arg',
      `PERSONAL_TOOLS_IMAGE=${GUEST_IMAGE}`,
      '-f',
      join(repository, images, 'runner.Dockerfile'),
      '--target',
      'personal',
      '-t',
      plan.image,
      ...label,
      repository,
    ],
    options,
  )
}

/** Build output goes to standard error with a prefix, so a long build shows its progress. */
function buildMessages(write) {
  return (line) => write.err(`[docker] ${line}\n`)
}

/** Copies the local runner image into the guest's Docker engine. */
async function loadRunner(context) {
  const { exec = runCommand, env, plan } = context
  await exec(
    'bash',
    [
      '-o',
      'pipefail',
      '-c',
      'docker save "$1" | limactl shell --workdir=/ "$2" sudo docker load',
      'bash',
      plan.image,
      plan.name,
    ],
    { timeout: IMAGE_LOAD_TIMEOUT_MS, env, stderr: messages(context.write, 'load') },
  )
}

/**
 * The instance's status: `Running`, another state, or an empty string when it doesn't exist.
 * Every instance is listed, because Lima fails rather than answering for a name it doesn't know.
 */
async function vmStatus(context) {
  const { exec = runCommand, env, plan } = context
  const output = await exec('limactl', ['list', '--format', '{{.Name}} {{.Status}}'], {
    timeout: GUEST_COMMAND_TIMEOUT_MS,
    env,
  })
  const entry = output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([name]) => name === plan.name)
  return entry?.[1] ?? ''
}

/** A command's own messages, prefixed, so a failed step shows its cause. */
function messages(write, prefix) {
  return write ? (line) => write.err(`[${prefix}] ${line}\n`) : undefined
}

/** Creates the VM from the repository's template, or starts it. Resolves true when it booted it. */
async function ensureVm(context) {
  const { exec = runCommand, env, plan, repository } = context
  const status = await vmStatus(context)
  if (status === 'Running') {
    return false
  }
  context.onBoot?.()
  if (status === '') {
    await exec(
      'limactl',
      [
        'start',
        '--tty=false',
        '--vm-type=vz',
        `--name=${plan.name}`,
        join(repository, 'tooling/deployment/lima/agent.yaml'),
      ],
      { timeout: VM_CREATE_TIMEOUT_MS, env, stderr: messages(context.write, 'limactl') },
    )
  } else {
    await exec('limactl', ['start', '--tty=false', plan.name], {
      timeout: VM_BOOT_TIMEOUT_MS,
      env,
      stderr: messages(context.write, 'limactl'),
    })
  }
  return true
}

/** Which sides of the pairing exist: complete on the host, and the guest's `guest/` directory. */
async function pairingState(context, { lstat = fsLstat } = {}) {
  const { plan, guestDir } = context
  const exists = async (path, kind) => {
    try {
      const stat = await lstat(path)
      return kind === 'file' ? stat.isFile() : true
    } catch {
      return false
    }
  }
  const hostFiles = await Promise.all(
    PAIRING_FILES.map((file) => exists(join(plan.pair, file), 'file')),
  )
  const hostComplete = hostFiles.every(Boolean)
  const hostPresent = hostComplete || (await exists(plan.pair))
  const guestComplete = await guestSucceeds(context, ['test', '-d', `${guestDir}/guest`])
  const guestPresent = guestComplete || (await guestSucceeds(context, ['test', '-e', guestDir]))
  return { hostComplete, hostPresent, guestComplete, guestPresent }
}

/** Pairs when neither side exists; refuses when only one does, removing nothing. */
async function ensurePairing(context, { lstat = fsLstat } = {}) {
  const { exec = runCommand, env, plan, guestDir, repository } = context
  const state = await pairingState(context, { lstat })
  if (state.hostComplete && state.guestComplete) {
    return 'done'
  }
  if (state.hostPresent || state.guestPresent) {
    throw new VmSetupError('vm_pairing_mismatch', [plan.pair, `${plan.name}:${guestDir}`])
  }
  await mkdir(dirname(plan.pair), { recursive: true, mode: 0o700 })
  await exec(
    'bash',
    [join(repository, 'tooling/deployment/bridge/pair.sh'), plan.name, plan.pair, guestDir],
    {
      timeout: PROVISION_TIMEOUT_MS,
      stderr: messages(context.write, 'setup'),
      env,
    },
  )
  return 'changed'
}

/**
 * Compares the host key file with the guest's key: `match`, or `none` when neither side has one.
 * One side only, or different contents, is refused and neither key is touched.
 */
async function checkOperatorKey(context, { read = readFile } = {}) {
  const { keyFile, guestDir, plan } = context
  let host = null
  try {
    host = sha256(await read(keyFile))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  const guest = await guestFileHash(context, `${guestDir}/operator/key`)
  if (host === null && guest === null) {
    return 'none'
  }
  if (host === null || guest === null || host !== guest) {
    throw new VmSetupError('vm_operator_key_mismatch', [
      keyFile,
      `${plan.name}:${guestDir}/operator/key`,
    ])
  }
  return 'match'
}

/** Makes the operator key only when neither side has one, and installs it in the guest. */
async function ensureOperatorKey(context, { read = readFile } = {}) {
  const { exec = runCommand, env, plan, guestDir, keyFile, repository } = context
  if ((await checkOperatorKey(context, { read })) === 'match') {
    return 'done'
  }
  await mkdir(dirname(keyFile), { recursive: true, mode: 0o700 })
  // `wx`: never replaces a key file that appeared since the check.
  await writeFile(keyFile, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' })
  await exec(
    'bash',
    [join(repository, 'tooling/deployment/bridge/operator-key.sh'), plan.name, guestDir, keyFile],
    {
      timeout: PROVISION_TIMEOUT_MS,
      stderr: messages(context.write, 'setup'),
      env,
    },
  )
  return 'changed'
}

/** Whether the guest's browser policy is the checkout's. */
async function browserPolicyCurrent(context, { read = readFile } = {}) {
  const local = sha256(await read(join(context.repository, BROWSER_POLICY)))
  return (await guestFileHash(context, `${context.guestDir}/browser-seccomp.json`)) === local
}

async function ensureBrowserPolicy(context, { read = readFile } = {}) {
  const { exec = runCommand, env, plan, guestDir, repository } = context
  if (await browserPolicyCurrent(context, { read })) {
    return 'done'
  }
  await exec(
    'bash',
    [join(repository, 'tooling/deployment/bridge/browser-policy.sh'), plan.name, guestDir],
    {
      timeout: PROVISION_TIMEOUT_MS,
      stderr: messages(context.write, 'setup'),
      env,
    },
  )
  return 'changed'
}

/** A guest container's image ID, running state and origin, or null when it doesn't exist. */
async function containerState(context, name) {
  let output
  try {
    output = await guestCommand(context, [
      'sudo',
      'docker',
      'inspect',
      '--format',
      '{{.Image}}|{{.State.Running}}|{{range .Config.Env}}{{.}};{{end}}',
      name,
    ])
  } catch {
    return null
  }
  const [image, running, environment = ''] = output.trim().split('|')
  const origin = environment
    .split(';')
    .find((entry) => entry.startsWith('INTAKE_OPERATOR_ORIGIN='))
    ?.slice('INTAKE_OPERATOR_ORIGIN='.length)
  return { image, running: running === 'true', origin: origin ?? null }
}

async function guestImageId(context) {
  try {
    const output = await guestCommand(context, [
      'sudo',
      'docker',
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      context.plan.image,
    ])
    return output.trim() || null
  } catch {
    return null
  }
}

/**
 * Each provider's services: `current` when every container runs the guest's runner image (for the
 * current origin, where it has one), `stopped` when they match but one isn't running, else `stale`.
 */
async function servicesState(context) {
  const imageId = await guestImageId(context)
  const providers = {}
  for (const [provider, { containers }] of Object.entries(GUEST_SERVICES)) {
    const states = await Promise.all(containers.map((name) => containerState(context, name)))
    const matches = states.every(
      (state, index) =>
        state !== null &&
        imageId !== null &&
        state.image === imageId &&
        (!MANAGEMENT_CONTAINERS.has(containers[index]) || state.origin === context.origin),
    )
    if (!matches) {
      providers[provider] = { state: 'stale' }
    } else {
      const stopped = containers.filter((_, index) => !states[index].running)
      providers[provider] = { state: stopped.length > 0 ? 'stopped' : 'current', stopped }
    }
  }
  return providers
}

async function startStoppedService(context, name) {
  try {
    await guestCommand(context, ['sudo', 'docker', 'start', name])
  } catch {
    throw new VmSetupError('vm_guest_service_start_failed', name)
  }
  const state = await containerState(context, name)
  if (!state?.running) {
    throw new VmSetupError('vm_guest_service_start_failed', name)
  }
}

async function provisionProvider(context, provider) {
  const { exec = runCommand, env, plan, guestDir, keyFile, origin, repository } = context
  const script = join(repository, GUEST_SERVICES[provider].script)
  const args =
    provider === 'claude'
      ? [plan.name, guestDir, plan.image, keyFile, origin]
      : [plan.name, guestDir, plan.image, origin, keyFile]
  try {
    await exec('bash', [script, ...args], {
      timeout: PROVISION_TIMEOUT_MS,
      env,
      stderr: messages(context.write, provider),
    })
  } catch {
    throw new VmSetupError('vm_guest_service_provision_failed', provider)
  }
}

/** Removes the retired document reader's container, which nothing runs any more. */
async function removeRetiredReader(context) {
  const listed = await guestCommand(context, [
    'sudo',
    'docker',
    'ps',
    '-aq',
    '--filter',
    `name=^${RETIRED_CONTAINER}$`,
  ])
  if (listed.trim() === '') {
    return false
  }
  await guestCommand(context, ['sudo', 'docker', 'rm', '-f', RETIRED_CONTAINER])
  return true
}

/**
 * Brings each provider's services to the current image and origin: stale ones are reprovisioned
 * (which checks the operator key first), stopped ones started and confirmed running.
 */
async function ensureGuestServices(context, { read = readFile } = {}) {
  let changed = await removeRetiredReader(context)
  const providers = await servicesState(context)
  const stale = Object.keys(providers).filter((provider) => providers[provider].state === 'stale')
  if (stale.length > 0) {
    await checkOperatorKey(context, { read })
  }
  for (const [provider, { state, stopped }] of Object.entries(providers)) {
    if (state === 'stale') {
      await provisionProvider(context, provider)
      changed = true
    } else if (state === 'stopped') {
      for (const name of stopped) {
        await startStoppedService(context, name)
      }
      changed = true
    }
  }
  return changed ? 'changed' : 'done'
}

module.exports = {
  VmSetupError,
  browserPolicyCurrent,
  buildImages,
  checkOperatorKey,
  checkPrerequisites,
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
}

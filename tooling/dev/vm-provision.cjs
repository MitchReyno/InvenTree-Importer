/**
 * Prepares the agent VM: the checks and steps `pnpm vm:setup` runs in full and `pnpm dev` runs to
 * keep the runner image current. Each step checks before it acts, so a rerun changes nothing that
 * is already in place. Commands are passed in, so tests can substitute them.
 */
const { createHash } = require('node:crypto')
const { lstat: fsLstat, mkdir, readFile } = require('node:fs/promises')
const { setTimeout: delay } = require('node:timers/promises')
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
/** How long a freshly provisioned service gets to fail before it is checked as running. */
const SERVICE_SETTLE_MS = 2000
/** Each image says which role it was built for, so an app or guest image is never taken as the runner. */
const ROLE_LABEL = 'org.bench-intake.image-role'
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
/**
 * The guest-directory entries each container mounts, as the provisioning scripts make them; a
 * container mounting anything else isn't the service the relays and tool workers expect.
 */
const SERVICE_MOUNTS = {
  'bench-claude-egress': ['egress'],
  // `guest`: the pairing identity that authenticates the status and model catalogue endpoints;
  // `egress`: the Anthropic-only route a catalogue read takes, as a turn's does.
  'bench-claude-management': ['claude-store', 'egress', 'guest', 'operator'],
  'bench-codex-egress': ['codex-egress'],
  'bench-codex-management': ['codex-egress', 'codex-state', 'guest', 'operator'],
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

/**
 * A guest file: `absent`, `empty`, or `present` with its SHA-256. A failed check rejects, so an
 * unreachable guest is never read as a missing file.
 */
async function guestFile(context, path) {
  const output = await guestCommand(context, [
    'sudo',
    'sh',
    '-c',
    'if test ! -e "$1"; then echo absent; elif test -s "$1"; then echo present; sha256sum < "$1"; else echo empty; fi',
    'sh',
    path,
  ])
  const [state, hashLine = ''] = output.trim().split('\n')
  return { state: state.trim(), hash: hashLine.trim().split(/\s+/)[0] || null }
}

/** A guest file's SHA-256, or null when it is absent or empty. */
async function guestFileHash(context, path) {
  const file = await guestFile(context, path)
  return file.state === 'present' ? file.hash : null
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

const LABELS_FORMAT = `{{index .Config.Labels "${DIGEST_LABEL}"}}|{{index .Config.Labels "${ROLE_LABEL}"}}`

/** The digest label of an image built for `role` (the runner by default), or null otherwise. */
function runnerDigest(output, expected = 'runner') {
  const [digest, role] = output.trim().split('|')
  return role === expected && digest && digest !== '<no value>' ? digest : null
}

/** Whether every local image the runner is built from carries the current digest. */
async function localImagesCurrent(context) {
  const images = [
    [APP_IMAGE, 'app'],
    [GUEST_IMAGE, 'guest'],
    [context.plan.image, 'runner'],
  ]
  for (const [image, role] of images) {
    if ((await localImageDigest(context, image, role)) !== context.digest) {
      return false
    }
  }
  return true
}

/** A local image's digest label, or null when it is missing or wasn't built for `role`. */
async function localImageDigest(context, image, role = 'runner') {
  const { exec = runCommand, env } = context
  let output
  try {
    output = await exec('docker', ['image', 'inspect', '--format', LABELS_FORMAT, image], {
      timeout: GUEST_COMMAND_TIMEOUT_MS,
      env,
    })
  } catch {
    return null
  }
  return runnerDigest(output, role)
}

/** Refuses a runner tag that names one of the images it is built from. */
function checkRunnerTag(plan) {
  const reference = canonicalImage(plan.image)
  // Without a tag, `docker save` would export every tag of the repository.
  if (reference === null) {
    throw new VmSetupError('vm_runner_image_tag_required', plan.image)
  }
  if (reference === canonicalImage(APP_IMAGE) || reference === canonicalImage(GUEST_IMAGE)) {
    throw new VmSetupError('vm_runner_image_name_reserved', plan.image)
  }
}

/**
 * An image reference as Docker resolves it, `repository:tag` with Docker Hub's implied prefix
 * removed, or null when it names no tag. A digest reference has no tag to save, so it is null too.
 */
function canonicalImage(reference) {
  if (reference.includes('@')) {
    return null
  }
  const slash = reference.lastIndexOf('/')
  const colon = reference.lastIndexOf(':')
  if (colon <= slash) {
    return null
  }
  return reference
    .replace(/^(docker\.io|index\.docker\.io|registry-1\.docker\.io)\//, '')
    .replace(/^library\//, '')
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
      LABELS_FORMAT,
      context.plan.image,
    ])
  } catch {
    return null
  }
  return runnerDigest(output)
}

/** Builds the app, guest and runner images, each labelled with the source digest. */
async function buildImages(context) {
  const { exec = runCommand, env, repository, plan, digest, write } = context
  const label = (role) => [
    '--label',
    `${DIGEST_LABEL}=${digest}`,
    '--label',
    `${ROLE_LABEL}=${role}`,
  ]
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
      ...label('app'),
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
      ...label('guest'),
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
      ...label('runner'),
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
    stderr: messages(context.write, 'limactl'),
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

/** Whether a host path exists, and whether it is a non-empty regular file. */
async function hostPath(path, lstat) {
  try {
    const stat = await lstat(path)
    return { exists: true, file: stat.isFile() && stat.size > 0 }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { exists: false, file: false }
    }
    throw error
  }
}

/** The guest side of the pairing: `complete` (all three files in `guest/`), `present` or `absent`. */
async function guestPairing(context) {
  // `sudo`: `guest/` belongs to the guest services' user, not the Lima login user.
  const output = await guestCommand(context, [
    'sudo',
    'sh',
    '-c',
    'if test -s "$1/guest/ca.pem" && test -s "$1/guest/cert.pem" && test -s "$1/guest/key.pem"; then echo complete; elif test -e "$1"; then echo present; else echo absent; fi',
    'sh',
    context.guestDir,
  ])
  return output.trim()
}

/**
 * The host side's files belong together: its certificate was issued by its CA, and its private key
 * is the certificate's.
 */
/** Each side's certificate names its peer role, as the TLS checks on each side require. */
const HOST_PEER = 'bench-coordinator'
const GUEST_PEER = 'bench-guest'
/** Reads a certificate from `input` (`-in <file>`) or standard input, and checks its peer name. */
const NAMES_PEER = (name, input = '') =>
  `openssl x509 ${input} -noout -subject -nameopt RFC2253 | grep -Eq '(^subject=|,)CN=${name}(,|$)'`

const HOST_PAIRING_VALID = [
  'cd "$1"',
  'openssl verify -CAfile ca.pem cert.pem >/dev/null 2>&1',
  NAMES_PEER(HOST_PEER, '-in cert.pem'),
  'test "$(openssl x509 -noout -pubkey -in cert.pem)" = "$(openssl pkey -pubout -in key.pem)"',
].join(' && ')

/** The guest has no OpenSSL; Python's TLS loader refuses a key that isn't the certificate's. */
const GUEST_KEY_MATCHES =
  'import ssl, sys; ssl.create_default_context().load_cert_chain(sys.argv[1], sys.argv[2])'

async function hostPairingValid(context) {
  const { exec = runCommand, env, plan } = context
  try {
    await exec('sh', ['-c', HOST_PAIRING_VALID, 'sh', plan.pair], {
      timeout: GUEST_COMMAND_TIMEOUT_MS,
      env,
    })
    return true
  } catch {
    return false
  }
}

/**
 * The guest side: its key is its certificate's (checked in the guest, so the key never leaves it),
 * and its certificate, which is public, was issued by the host's CA (checked on the host).
 */
/** Whether a certificate was issued by the CA in `caPath` and names the guest peer. */
async function guestCertificateValid(caPath, certificate, { exec = runCommand, env } = {}) {
  try {
    await exec(
      'sh',
      [
        '-c',
        `printf %s "$2" | openssl verify -CAfile "$1" >/dev/null 2>&1 && printf %s "$2" | ${NAMES_PEER(GUEST_PEER)}`,
        'sh',
        caPath,
        certificate,
      ],
      { timeout: GUEST_COMMAND_TIMEOUT_MS, env },
    )
    return true
  } catch {
    return false
  }
}

async function guestPairingValid(context) {
  const { exec = runCommand, env, plan, guestDir } = context
  try {
    await guestCommand(context, [
      'sudo',
      'python3',
      '-c',
      GUEST_KEY_MATCHES,
      `${guestDir}/guest/cert.pem`,
      `${guestDir}/guest/key.pem`,
    ])
  } catch {
    return false
  }
  const certificate = await guestCommand(context, ['sudo', 'cat', `${guestDir}/guest/cert.pem`])
  return guestCertificateValid(join(plan.pair, 'ca.pem'), certificate, { exec, env })
}

function pairingMismatch(context) {
  return new VmSetupError('vm_pairing_mismatch', [
    context.plan.pair,
    `${context.plan.name}:${context.guestDir}`,
  ])
}

/**
 * Checks the pairing without changing it: `match` when both sides are complete and issued by the
 * same CA, `none` when neither side exists. Anything else is refused, naming both directories.
 */
async function checkPairing(context, { lstat = fsLstat, read = readFile } = {}) {
  const { plan, guestDir } = context
  const files = await Promise.all(
    PAIRING_FILES.map((file) => hostPath(join(plan.pair, file), lstat)),
  )
  const hostComplete = files.every((file) => file.file)
  const hostPresent = hostComplete || (await hostPath(plan.pair, lstat)).exists
  const guest = await guestPairing(context)
  if (!hostPresent && guest === 'absent') {
    return 'none'
  }
  if (!hostComplete || guest !== 'complete') {
    throw pairingMismatch(context)
  }
  // Files from another pairing would pass a presence check but never authenticate: both sides
  // must share the CA, and each certificate and key must belong to it.
  const hostCa = sha256(await read(join(plan.pair, 'ca.pem')))
  if ((await guestFileHash(context, `${guestDir}/guest/ca.pem`)) !== hostCa) {
    throw pairingMismatch(context)
  }
  if (!(await hostPairingValid(context)) || !(await guestPairingValid(context))) {
    throw pairingMismatch(context)
  }
  return 'match'
}

/**
 * The guest's session storage, which `pair.sh` creates and relays mount. A pairing restored
 * without it gets it back, empty, with the pairing and any other state left alone.
 */
async function ensureSessionStorage(context) {
  const sessions = `${context.guestDir}/sessions`
  const present = await guestCommand(context, [
    'sudo',
    'sh',
    '-c',
    'if test -d "$1"; then echo present; else echo absent; fi',
    'sh',
    sessions,
  ])
  if (present.trim() === 'present') {
    return false
  }
  await guestCommand(context, [
    'sudo',
    'install',
    '-d',
    '-o',
    '1000',
    '-g',
    '1000',
    '-m',
    '700',
    sessions,
  ])
  return true
}

/** Pairs when neither side exists; refuses when only one does, removing nothing. */
async function ensurePairing(context, { lstat = fsLstat, read = readFile } = {}) {
  const { exec = runCommand, env, plan, guestDir, repository } = context
  if ((await checkPairing(context, { lstat, read })) === 'match') {
    return (await ensureSessionStorage(context)) ? 'changed' : 'done'
  }
  await mkdir(dirname(plan.pair), { recursive: true, mode: 0o700 })
  await exec(
    'bash',
    [join(repository, 'tooling/deployment/bridge/pair.sh'), plan.name, plan.pair, guestDir],
    { timeout: PROVISION_TIMEOUT_MS, stderr: messages(context.write, 'setup'), env },
  )
  return 'changed'
}

/**
 * Before a VM is created: with no VM there is no guest side, so a host pairing or key file already
 * in place is one-sided and refused before anything, the VM's disk included, is made.
 */
async function checkHostIdentityAlone(context, { lstat = fsLstat } = {}) {
  if ((await hostPath(context.plan.pair, lstat)).exists) {
    throw pairingMismatch(context)
  }
  if ((await hostPath(context.keyFile, lstat)).exists) {
    throw new VmSetupError('vm_operator_key_mismatch', [
      context.keyFile,
      `${context.plan.name}:${context.guestDir}/operator/key`,
    ])
  }
  return 'done'
}

/**
 * Compares the host key file with the guest's key: `match`, or `none` when neither side has one.
 * A key on one side only, an empty key or two different keys is refused and neither is touched.
 */
async function checkOperatorKey(
  context,
  { lstat = fsLstat, read = readFile, allowNone = true } = {},
) {
  const { keyFile, guestDir, plan } = context
  const mismatch = new VmSetupError('vm_operator_key_mismatch', [
    keyFile,
    `${plan.name}:${guestDir}/operator/key`,
  ])
  const host = await hostPath(keyFile, lstat)
  const guest = await guestFile(context, `${guestDir}/operator/key`)
  // Only setup may create a key; a refresh needs the existing one on both sides.
  if (!host.exists && guest.state === 'absent' && allowNone) {
    return 'none'
  }
  if (!host.file || guest.state !== 'present') {
    throw mismatch
  }
  if (sha256(await read(keyFile)) !== guest.hash) {
    throw mismatch
  }
  return 'match'
}

/** Makes the operator key on both sides only when neither has one; `operator-key.sh` does it. */
async function ensureOperatorKey(context, { lstat = fsLstat, read = readFile } = {}) {
  const { exec = runCommand, env, plan, guestDir, keyFile, repository } = context
  if ((await checkOperatorKey(context, { lstat, read })) === 'match') {
    return 'done'
  }
  await mkdir(dirname(keyFile), { recursive: true, mode: 0o700 })
  await exec(
    'bash',
    [join(repository, 'tooling/deployment/bridge/operator-key.sh'), plan.name, guestDir, keyFile],
    { timeout: PROVISION_TIMEOUT_MS, stderr: messages(context.write, 'setup'), env },
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

/**
 * A guest container's image ID, running state, bind-mount sources and origin, or null when it
 * doesn't exist.
 */
async function containerState(context, name) {
  let output
  try {
    output = await guestCommand(context, [
      'sudo',
      'docker',
      'inspect',
      '--format',
      '{{.Image}}|{{.State.Status}}|{{range .Mounts}}{{.Source}};{{end}}|{{range .Config.Env}}{{.}};{{end}}',
      name,
    ])
  } catch {
    return null
  }
  const [image, status, mounts, ...rest] = output.trim().split('|')
  const origin = rest
    .join('|')
    .split(';')
    .find((entry) => entry.startsWith('INTAKE_OPERATOR_ORIGIN='))
    ?.slice('INTAKE_OPERATOR_ORIGIN='.length)
  return {
    image,
    // Only `running`: a container in restart backoff reports Running=true with no process.
    running: status === 'running',
    mounts: mounts.split(';').filter(Boolean),
    origin: origin ?? null,
  }
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

/** Whether a container runs this installation's runner image, for the current origin if it has one. */
function serviceMatches(context, name, state, imageId) {
  const expected = SERVICE_MOUNTS[name].map((entry) => `${context.guestDir}/${entry}`).sort()
  return (
    state !== null &&
    imageId !== null &&
    state.image === imageId &&
    JSON.stringify([...state.mounts].sort()) === JSON.stringify(expected) &&
    (!MANAGEMENT_CONTAINERS.has(name) || state.origin === context.origin)
  )
}

/**
 * A container of the same name that mounts another installation's directories is refused: it is
 * neither reused nor replaced.
 */
function checkOwnership(context, name, state) {
  const inside = (source) => source.startsWith(`${context.guestDir}/`)
  // Ownership needs evidence: a container with no mounts in this directory isn't this one's.
  if (state !== null && (state.mounts.length === 0 || !state.mounts.every(inside))) {
    throw new VmSetupError('vm_guest_service_conflict', name)
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
    containers.forEach((name, index) => checkOwnership(context, name, states[index]))
    const matches = containers.every((name, index) =>
      serviceMatches(context, name, states[index], imageId),
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
  const { script, containers } = GUEST_SERVICES[provider]
  const args =
    provider === 'claude'
      ? [plan.name, guestDir, plan.image, keyFile, origin]
      : [plan.name, guestDir, plan.image, origin, keyFile]
  try {
    await exec('bash', [join(repository, script), ...args], {
      timeout: PROVISION_TIMEOUT_MS,
      // A refresh never makes a key, even if both disappeared after its first check.
      env: context.keyVerifyOnly ? { ...env, INTAKE_OPERATOR_KEY_VERIFY_ONLY: '1' } : env,
      stderr: messages(context.write, provider),
    })
  } catch {
    throw new VmSetupError('vm_guest_service_provision_failed', provider)
  }
  // `docker run --detach` returns before the service could fail, so each one is checked after.
  await delay(context.settleMs ?? SERVICE_SETTLE_MS)
  const imageId = await guestImageId(context)
  for (const name of containers) {
    const state = await containerState(context, name)
    if (!serviceMatches(context, name, state, imageId) || !state.running) {
      throw new VmSetupError('vm_guest_service_start_failed', name)
    }
  }
}

/** Removes the retired document reader's container, which nothing runs any more. */
async function removeRetiredReader(context) {
  const reader = await containerState(context, RETIRED_CONTAINER)
  // Only this installation's reader, which mounted exactly its `web` directory; another is left.
  const web = `${context.guestDir}/web`
  if (reader === null || reader.mounts.length !== 1 || reader.mounts[0] !== web) {
    return false
  }
  await guestCommand(context, ['sudo', 'docker', 'rm', '-f', RETIRED_CONTAINER])
  return true
}

/**
 * Brings each provider's services to the current image and origin: stale ones are reprovisioned
 * (which checks the operator key first), stopped ones started and confirmed running.
 */
async function ensureGuestServices(context, { lstat = fsLstat, read = readFile } = {}) {
  let changed = await removeRetiredReader(context)
  const providers = await servicesState(context)
  const stale = Object.keys(providers).filter((provider) => providers[provider].state === 'stale')
  if (stale.length > 0) {
    await checkOperatorKey(context, { lstat, read, allowNone: !context.keyVerifyOnly })
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
  checkHostIdentityAlone,
  checkOperatorKey,
  checkPairing,
  checkPrerequisites,
  checkRunnerTag,
  ensureBrowserPolicy,
  ensureGuestServices,
  ensureOperatorKey,
  ensurePairing,
  ensureVm,
  guestCertificateValid,
  guestImageDigest,
  hostPairingValid,
  loadRunner,
  localImageDigest,
  localImagesCurrent,
  vmStatus,
  servicesState,
  sourceDigest,
}

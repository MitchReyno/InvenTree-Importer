/**
 * The runner image's source digest: a SHA-256 over every file its build chain reads, so a local
 * image built from older sources is found without building. Images carry it as a label.
 */
const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { runCommand } = require('./vm.cjs')

const DIGEST_LABEL = 'org.bench-intake.source-digest'

/** The Dockerfiles that build the runner, each with the `.dockerignore` that decides its context. */
const RUNNER_DOCKERFILES = [
  'tooling/deployment/images/app.Dockerfile',
  'tooling/deployment/images/runner.Dockerfile',
]
/** The guest image is built from this directory as its whole context. */
const GUEST_CONTEXT = 'tooling/deployment/guest'

const GIT_TIMEOUT_MS = 30_000

/**
 * The build-context paths a Dockerfile copies: every `COPY` source, skipping `COPY --from` stage
 * copies. A form this parser can't read is refused, so a source is never silently left out.
 */
function copySources(dockerfile) {
  const sources = []
  const lines = dockerfile.replace(/\\\n/g, ' ').split('\n')
  for (const line of lines) {
    const words = line.trim().split(/\s+/)
    if (words[0]?.toUpperCase() === 'ADD') {
      throw new Error('runner_digest_unsupported_copy')
    }
    if (words[0]?.toUpperCase() !== 'COPY') {
      continue
    }
    const flags = words.slice(1).filter((word) => word.startsWith('--'))
    const paths = words.slice(1 + flags.length)
    if (flags.some((flag) => flag.startsWith('--from='))) {
      continue
    }
    if (paths.length < 2 || paths[0].startsWith('[') || paths.some((path) => path.includes('$'))) {
      throw new Error('runner_digest_unsupported_copy')
    }
    sources.push(...paths.slice(0, -1).map((path) => path.replace(/^\.\//, '').replace(/\/$/, '')))
  }
  return sources
}

/** Every path the digest covers, from the Dockerfiles themselves. */
async function digestInputs(repository, { read = readFile } = {}) {
  const inputs = new Set([GUEST_CONTEXT])
  for (const dockerfile of RUNNER_DOCKERFILES) {
    inputs.add(dockerfile)
    inputs.add(`${dockerfile}.dockerignore`)
    const text = await read(join(repository, dockerfile), 'utf8')
    for (const source of copySources(text)) {
      inputs.add(source)
    }
  }
  return [...inputs].sort()
}

/** Tracked and untracked files under the inputs that Git doesn't ignore, sorted. */
async function inputFiles(repository, inputs, { exec = runCommand } = {}) {
  const output = await exec(
    'git',
    [
      '-C',
      repository,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--deduplicate',
      '--',
      ...inputs,
    ],
    { timeout: GIT_TIMEOUT_MS },
  )
  return [...new Set(output.split('\0').filter(Boolean))].sort()
}

/** The digest of the runner's sources as they are in the checkout now, uncommitted edits included. */
async function sourceDigest(repository, { exec = runCommand, read = readFile } = {}) {
  const inputs = await digestInputs(repository, { read })
  const files = await inputFiles(repository, inputs, { exec })
  const digest = createHash('sha256')
  for (const file of files) {
    let content
    try {
      content = await read(join(repository, file))
    } catch (error) {
      // A tracked file deleted from the working tree isn't part of the build.
      if (error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    const fileHash = createHash('sha256').update(content).digest('hex')
    digest.update(`${file}\0${fileHash}\n`)
  }
  return digest.digest('hex')
}

module.exports = { DIGEST_LABEL, copySources, digestInputs, sourceDigest }

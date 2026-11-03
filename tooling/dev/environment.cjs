const { open, constants, realpath } = require('node:fs/promises')
const { resolve, join, dirname, basename, sep } = require('node:path')
const { parseEnv } = require('node:util')

class DevelopmentEnvError extends Error {}

const MAX_ENV_BYTES = 64 * 1024
const SETTINGS = new Set([
  'INTAKE_DEV_PORT',
  'INTAKE_APP_STATE',
  'INTAKE_DEV_STATE',
  'INTAKE_DEV_ADMIN_URL',
  'INTAKE_MEDIA_DECODER_IMAGE',
  'INTAKE_PROCESSING_PROFILE',
  'INTAKE_TARGET_PROFILE',
  'INTAKE_READ_ORIGIN',
  'INTAKE_DEV_API_KEY',
  'INTAKE_CREDENTIAL_REF',
  'INTAKE_CODEX_EXECUTABLE',
  'INTAKE_CLAUDE_EXECUTABLE',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'INTAKE_ORIGIN',
  'INTAKE_DATABASE_URL',
  'INTAKE_ACTOR_ID',
  'INTAKE_TARGET_ID',
  'INTAKE_TARGET_CONTEXT_ID',
  'INTAKE_BLOB_ROOT',
  'INTAKE_DEPLOYMENT_ID',
  'INTAKE_PROCESSING_CHANNEL_SECRET',
  'INTAKE_RESEARCH_SOURCE_URLS',
  'INTAKE_RESEARCH_PROTECTED_ORIGINS',
])

const API_SETTINGS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'LANG',
  'NODE_ENV',
  'INTAKE_ORIGIN',
  'INTAKE_DEV_LISTEN_PORT',
  'INTAKE_DATABASE_URL',
  'INTAKE_ACTOR_ID',
  'INTAKE_TARGET_ID',
  'INTAKE_TARGET_CONTEXT_ID',
  'INTAKE_CREDENTIAL_REF',
  'INTAKE_DEV_API_KEY',
  'INTAKE_READ_ORIGIN',
  'INTAKE_BLOB_ROOT',
  'INTAKE_DEPLOYMENT_ID',
  'INTAKE_PROCESSING_PROFILE',
  'INTAKE_PROCESSING_CHANNEL_SECRET',
  'INTAKE_RESEARCH_SOURCE_URLS',
  'INTAKE_RESEARCH_PROTECTED_ORIGINS',
])

/** Setup/provider secrets belong to their owners, never the standalone HTTP child. */
function apiEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) => API_SETTINGS.has(key) && value !== undefined,
    ),
  )
}

/** Deliberately returns data: dotenv cannot set process flags, PATH or client Vite values. */
async function developmentEnvironment(
  repository,
  inherited = process.env,
  cwd = inherited.INIT_CWD ?? process.cwd(),
) {
  const selector = inherited.INTAKE_ENV_FILE
  if (selector === '') {
    return { ...inherited }
  }
  const file = selector === undefined ? join(repository, '.env') : resolve(cwd, selector)
  let handle
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (selector === undefined && error.code === 'ENOENT') {
      return { ...inherited }
    }
    throw new DevelopmentEnvError('development_env_file_unreadable')
  }
  let values
  try {
    const canonicalFile = await realpath(file)
    const canonicalRepository = await realpath(repository)
    const inside = canonicalFile.startsWith(canonicalRepository + sep)
    if (
      inside &&
      (dirname(canonicalFile) !== canonicalRepository ||
        !/^\.env(?:\..+)?$/.test(basename(canonicalFile)))
    ) {
      throw new DevelopmentEnvError('development_env_file_private_location_required')
    }
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_ENV_BYTES) {
      throw new DevelopmentEnvError('development_env_file_invalid')
    }
    const buffer = Buffer.alloc(MAX_ENV_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) {
        break
      }
      length += bytesRead
    }
    if (length > MAX_ENV_BYTES) {
      throw new DevelopmentEnvError('development_env_file_invalid')
    }
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))
      values = parseEnv(content)
    } catch {
      throw new DevelopmentEnvError('development_env_file_invalid')
    }
  } catch (error) {
    if (error instanceof DevelopmentEnvError) {
      throw error
    }
    throw new DevelopmentEnvError('development_env_file_unreadable')
  } finally {
    await handle.close()
  }
  const accepted = Object.fromEntries(Object.entries(values).filter(([key]) => SETTINGS.has(key)))
  return { ...accepted, ...inherited }
}
module.exports = { developmentEnvironment, apiEnvironment }

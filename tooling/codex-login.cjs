#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { lstat, mkdir, chmod, realpath } = require('node:fs/promises')
const { join, resolve, sep, dirname } = require('node:path')
const { pathToFileURL } = require('node:url')
const { developmentEnvironment } = require('./dev/environment.cjs')
const {
  resolveDevelopmentSettings,
  targetEnvironment,
  settingsRefusalLines,
  DevelopmentSettingsError,
} = require('./dev/settings.cjs')

const repository = resolve(__dirname, '..')
const intake = join(repository, 'intake-server')

const CUSTOMIZATIONS = ['config.toml', 'hooks.json', 'skills', 'plugins']

function codexExecutable(settings) {
  const configured = settings.INTAKE_CODEX_EXECUTABLE
  if (configured === undefined || configured === '') {
    return 'codex'
  }
  if (configured.includes('\0') || /[\r\n]/.test(configured)) {
    throw new Error('codex_executable_missing')
  }
  return configured
}

async function loadStateModules() {
  const targetModule = await import(pathToFileURL(join(intake, 'src/dev/target.ts')).href)
  const identity = await import(pathToFileURL(join(intake, 'src/dev/pg-identity.ts')).href)
  const localInventree = await import(
    pathToFileURL(join(intake, 'src/dev/local-inventree.ts')).href
  )
  return { targetModule, identity, localInventree }
}

/** The app directory `pnpm dev` retains, including an explicit INTAKE_APP_STATE. */
async function appStateRoot(settings) {
  const { targetSettings } = resolveDevelopmentSettings(settings)
  const values = targetEnvironment(settings, targetSettings)
  const { targetModule, identity, localInventree } = await loadStateModules()
  const target = targetModule.developmentTarget(values)
  if (values.INTAKE_APP_STATE !== undefined) {
    return targetModule.developmentStateRoot(values, target, { serverId: '' })
  }
  const serverId = await identity.serverIdentity(values)
  const scope = { serverId }
  if (target.kind === 'local-inventree') {
    scope.instanceId = (await localInventree.readLocalInventree(values)).instanceId
  }
  return targetModule.developmentStateRoot(values, target, scope)
}

function assertOutsideRepository(root) {
  if (root === repository || root.startsWith(repository + sep)) {
    throw new Error('development_state_must_be_outside_repository')
  }
}

async function ensurePrivateDirectory(path) {
  // Check existing ancestors before mkdir/chmod can follow a symlink.
  let ancestor = path
  while (true) {
    try {
      const canonical = await realpath(ancestor)
      if (canonical !== ancestor) throw new Error('private_codex_home_required')
      assertOutsideRepository(canonical)
      break
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = dirname(ancestor)
      if (parent === ancestor) throw new Error('private_codex_home_required')
      ancestor = parent
    }
  }
  await mkdir(path, { recursive: true, mode: 0o700 })
  let stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
    throw new Error('private_codex_home_required')
  }
  if (stat.mode & 0o077) {
    await chmod(path, 0o700)
    stat = await lstat(path)
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    (await realpath(path)) !== path
  ) {
    throw new Error('private_codex_home_required')
  }
}

async function rejectCustomizations(home) {
  for (const name of CUSTOMIZATIONS) {
    try {
      await lstat(join(home, name))
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        continue
      }
      throw new Error('private_codex_home_required')
    }
    throw new Error('agent_home_customizations_refused')
  }
}

/** Creates `$INTAKE_APP_STATE/agents/codex` and returns that path. */
async function prepareCodexHome(root) {
  assertOutsideRepository(root)
  const agents = join(root, 'agents')
  const home = join(agents, 'codex')
  await ensurePrivateDirectory(root)
  await ensurePrivateDirectory(agents)
  await ensurePrivateDirectory(home)
  await rejectCustomizations(home)
  return home
}

function waitForExit(child) {
  return new Promise((resolveExit, reject) => {
    let settled = false
    const finish = (action) => {
      if (settled) {
        return
      }
      settled = true
      action()
    }
    child.once('error', (error) => {
      finish(() => {
        if (error && error.code === 'ENOENT') {
          reject(new Error('codex_executable_missing'))
          return
        }
        reject(new Error('codex_login_failed'))
      })
    })
    child.once('close', (code, signal) => {
      finish(() => resolveExit({ code, signal }))
    })
  })
}

/**
 * Resolves this checkout's dev app state, then runs interactive `codex login`
 * with CODEX_HOME set to its private subscription directory.
 */
async function runCodexLogin({
  settings,
  spawnImpl = spawn,
  baseEnv = process.env,
  log = console.error,
}) {
  const root = await appStateRoot(settings)
  const home = await prepareCodexHome(root)
  const executable = codexExecutable(settings)
  log(`Codex subscription login. CODEX_HOME=${home}`)
  const child = spawnImpl(executable, ['login'], {
    stdio: 'inherit',
    shell: false,
    env: { ...baseEnv, CODEX_HOME: home },
  })
  const { code, signal } = await waitForExit(child)
  if (signal || code === null) {
    throw new Error('codex_login_failed')
  }
  return code
}

async function main() {
  const major = Number(process.versions.node.split('.')[0])
  if (major !== 24) {
    throw new Error('pinned_node_24_required')
  }
  const settings = await developmentEnvironment(repository)
  const code = await runCodexLogin({ settings })
  process.exitCode = code
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof DevelopmentSettingsError) {
      process.stderr.write(`${settingsRefusalLines(error).join('\n')}\n`)
      process.exitCode = 1
      return
    }
    const code = /^[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'codex_login_failed'
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  appStateRoot,
  prepareCodexHome,
  runCodexLogin,
}

import { isAbsolute, join, resolve } from 'node:path'
import { lstat, mkdir } from 'node:fs/promises'
import type { AgentSelectionDto } from '@invimport/contracts'

export interface NativeAgentHost {
  codexExecutable: string
  claudeExecutable: string
  stateRoot: string
  env: NodeJS.ProcessEnv
}

/** Explicit host config only. No dotenv discovery, auth-store copying, or inventory credential inheritance. */
export function nativeAgentHost(env: NodeJS.ProcessEnv): NativeAgentHost {
  const stateRoot = env.INTAKE_AGENT_STATE_ROOT
  if (!stateRoot || !isAbsolute(stateRoot)) {
    throw new Error('private_agent_state_required')
  }
  return {
    stateRoot: resolve(stateRoot),
    codexExecutable: env.INTAKE_CODEX_EXECUTABLE ?? 'codex',
    claudeExecutable: env.INTAKE_CLAUDE_EXECUTABLE ?? 'claude',
    env,
  }
}

export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  ) {
    throw new Error('private_agent_state_required')
  }
  return path
}

export function agentEnvironment(
  host: NativeAgentHost,
  selection: AgentSelectionDto,
  cwd: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TMPDIR: cwd }
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SHELL', 'SYSTEMROOT']) {
    if (host.env[name] !== undefined) {
      env[name] = host.env[name]
    }
  }
  // No proxy, alternate API origin, OAuth token, cloud credential or application DB/channel secret crosses this seam.
  if (selection.provider === 'codex') {
    env.CODEX_HOME = join(
      host.stateRoot,
      selection.authentication === 'subscription' ? 'codex' : 'codex-api',
    )
  }
  if (selection.authentication === 'api_key') {
    const keyName = selection.provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
    const key = host.env[keyName]
    if (!key?.trim()) {
      throw new Error('agent_login_required')
    }
    env[keyName] = key
  }
  return env
}

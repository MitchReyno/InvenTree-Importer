import { execFileSync, spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

// Erasable TypeScript only: the .cjs dev scripts load this module through Node's type stripping.

/** Docker on PATH, through DOCKER_BIN, or Docker.app by bundle ID; never a developer path. */
export async function dockerPath(env: Record<string, string | undefined> = process.env) {
  if (env.DOCKER_BIN) {
    return env.DOCKER_BIN
  }
  const found = spawnSync('which', ['docker'], { encoding: 'utf8' })
  if (found.status === 0) {
    return found.stdout.trim()
  }
  const applications = spawnSync('mdfind', ['kMDItemCFBundleIdentifier == "com.docker.docker"'], {
    encoding: 'utf8',
  })
  for (const app of (applications.stdout ?? '').trim().split('\n').filter(Boolean)) {
    const candidate = resolve(app, 'Contents/Resources/bin/docker')
    try {
      await access(candidate)
      return candidate
    } catch {
      /* next bundle */
    }
  }
  throw new Error('docker_not_found_set_DOCKER_BIN')
}

/** Parses `docker ... --format json` output, one JSON object per line. */
export function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** Label string from `docker volume ls --format json`, e.g. "a=b,c=d". */
export function labels(value: unknown): Record<string, string> {
  if (value && typeof value === 'object') {
    return value as Record<string, string>
  }
  return Object.fromEntries(
    String(value ?? '')
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf('=')
        return index < 0 ? [pair, ''] : [pair.slice(0, index), pair.slice(index + 1)]
      }),
  )
}

export function runner(docker: string, env: Record<string, string | undefined> = process.env) {
  return (...args: string[]) =>
    execFileSync(docker, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env })
}

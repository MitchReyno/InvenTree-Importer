#!/usr/bin/env node
'use strict'

const { readFile, lstat } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { homedir } = require('node:os')
const { resolve } = require('node:path')

/** Reuses retained helper credentials silently. Never starts, stops or migrates a service. */
async function main() {
  const directory = process.env.INTAKE_DEV_STATE ?? resolve(homedir(), '.local/state/bench-intake')
  const stateFile = resolve(directory, 'postgres.json')
  const metadata = await lstat(stateFile)
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error('private_owned_pg_state_required')
  }
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  if (typeof state.admin !== 'string' || !/^[a-f0-9]{32,128}$/.test(state.admin)) {
    throw new Error('invalid_owned_pg_state')
  }
  const url = new URL('postgresql://postgres@127.0.0.1:55432/postgres')
  url.password = state.admin
  const environment = {
    PATH: process.env.PATH,
    INTAKE_TEST_ADMIN_URL: url.toString(),
    INTAKE_TEST_ALLOW_CREATE_DATABASE: 'owned-sandbox',
  }
  if (process.env.INTAKE_MEDIA_DECODER_IMAGE) {
    environment.INTAKE_MEDIA_DECODER_IMAGE = process.env.INTAKE_MEDIA_DECODER_IMAGE
  }
  const selectedPattern = process.argv[2]
  const testOptions = selectedPattern ? ['--test-name-pattern', selectedPattern] : []
  const child = spawn(
    process.execPath,
    [
      require.resolve('tsx/cli'),
      '--test',
      '--test-concurrency=1',
      ...testOptions,
      'tests/pg/media.test.ts',
    ],
    {
      cwd: resolve(__dirname, '..'),
      env: environment,
      stdio: 'inherit',
    },
  )
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', resolveExit)
  })
  process.exitCode = code ?? 1
}

main().catch(() => {
  process.stderr.write('owned_media_pg_check_failed\n')
  process.exitCode = 1
})

#!/usr/bin/env node
'use strict'

const { readdir } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { resolve } = require('node:path')
const { developmentAdmin } = require('../src/dev/pg-identity.ts')
const { developmentEnvironment } = require('../../tooling/dev/environment.cjs')

async function testFiles(directory) {
  const entries = await readdir(resolve(__dirname, '..', directory), { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => `${directory}/${entry.name}`)
    .sort()
}

/** Reuses retained helper credentials silently. Never starts, stops or migrates a service. */
async function main() {
  const settings = await developmentEnvironment(resolve(__dirname, '../..'))
  const url = await developmentAdmin({ INTAKE_DEV_STATE: settings.INTAKE_DEV_STATE })
  const environment = {
    PATH: process.env.PATH,
    INTAKE_TEST_ADMIN_URL: url.toString(),
    INTAKE_TEST_ALLOW_CREATE_DATABASE: 'owned-sandbox',
  }
  for (const imageSetting of ['INTAKE_MEDIA_DECODER_IMAGE', 'INTAKE_MEDIA_PROBE_IMAGE']) {
    if (process.env[imageSetting]) {
      environment[imageSetting] = process.env[imageSetting]
    }
  }
  const suite = process.argv[3] ?? 'retention'
  const suites = {
    retention: 'tests/pg/media.test.ts',
    renditions: 'tests/pg/media-renditions.test.ts',
    backfill: 'tests/pg/media-backfill.test.ts',
    inputs: 'tests/pg/media-input-scopes.test.ts',
    research: 'tests/pg/research.test.ts',
    'research-processing': 'tests/process/research-processing.test.ts',
    executor: 'tests/pg/media-executor.test.ts',
    browser: 'tests/fixtures/media-browser.ts',
    startup: 'tests/pg/media-startup-authority.test.ts',
    'all-pg': 'tests/pg',
    'all-process': 'tests/process',
    'processing-browser': 'tests/fixtures/processing-browser.ts',
  }
  if (!Object.hasOwn(suites, suite)) {
    throw new Error('unknown_media_pg_suite')
  }
  const selectedPattern = process.argv[2]
  const testOptions = selectedPattern ? ['--test-name-pattern', selectedPattern] : []
  const browserSuite = suite === 'browser' || suite === 'processing-browser'
  let files = [suites[suite]]
  if (suite === 'all-pg' || suite === 'all-process') {
    files = await testFiles(suites[suite])
    if (suite === 'all-process') {
      // Serial-only process tests live one level down and run after the rest.
      files.push(...(await testFiles(`${suites[suite]}/serial`)))
    }
    if (files.length === 0) {
      throw new Error('owned_pg_test_suite_empty')
    }
  }
  const childArguments = browserSuite
    ? [require.resolve('tsx/cli'), ...files]
    : [require.resolve('tsx/cli'), '--test', '--test-concurrency=1', ...testOptions, ...files]
  const child = spawn(process.execPath, childArguments, {
    cwd: resolve(__dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
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

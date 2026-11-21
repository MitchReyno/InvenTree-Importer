#!/usr/bin/env node
'use strict'

const { mkdtemp, cp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const repository = resolve(__dirname, '../..')
const allowed = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'contracts/package.json',
  'contracts/src',
  'intake-server/package.json',
  'media-decoder/package.json',
  'media-decoder/src',
  'frontend/package.json',
  'tooling/openapi-generator/package.json',
]

function requestedOutputFile() {
  const cliArguments = process.argv.slice(2)
  if (cliArguments.length === 0) {
    return undefined
  }
  if (cliArguments.length !== 2 || cliArguments[0] !== '--output-file' || !cliArguments[1].trim()) {
    throw new Error('expected_optional_output_file')
  }
  return cliArguments[1]
}

async function build(context, outputFile) {
  const imageFile = join(context, 'image-id')
  const child = spawn(
    'docker',
    ['build', '--iidfile', imageFile, '--file', join(context, 'Dockerfile'), context],
    { stdio: 'inherit' },
  )
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', resolveExit)
  })
  if (code !== 0) {
    throw new Error('decoder_image_build_failed')
  }
  const image = (await readFile(imageFile, 'utf8')).trim()
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('invalid_decoder_image_identity')
  }
  if (outputFile) {
    await writeFile(outputFile, `${image}\n`, { flag: 'wx', mode: 0o600 })
  }
  process.stdout.write(`Decoder image: ${image}\n`)
}

async function main() {
  const outputFile = requestedOutputFile()
  const context = await mkdtemp(join(tmpdir(), 'intake-media-build-'))
  try {
    for (const relative of allowed) {
      const destination = join(context, relative)
      await mkdir(resolve(destination, '..'), { recursive: true })
      await cp(join(repository, relative), destination, { recursive: true })
    }
    await cp(join(repository, 'intake-server/media-image/Dockerfile'), join(context, 'Dockerfile'))
    await build(context, outputFile)
  } finally {
    await rm(context, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})

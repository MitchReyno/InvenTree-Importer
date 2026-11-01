#!/usr/bin/env node
'use strict'

const { mkdtemp, cp, mkdir, readFile, rm } = require('node:fs/promises')
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
  'intake-server/src/media',
  'frontend/package.json',
]

async function build(context) {
  const imageFile = join(context, 'image-id')
  const child = spawn(
    'docker',
    [
      'build',
      '--iidfile',
      imageFile,
      '--file',
      join(context, 'Dockerfile'),
      context,
    ],
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
  process.stdout.write(`Decoder image: ${image}\n`)
}

async function main() {
  const context = await mkdtemp(join(tmpdir(), 'intake-media-build-'))
  try {
    for (const relative of allowed) {
      const destination = join(context, relative)
      await mkdir(resolve(destination, '..'), { recursive: true })
      await cp(join(repository, relative), destination, { recursive: true })
    }
    await cp(join(repository, 'intake-server/media-image/Dockerfile'), join(context, 'Dockerfile'))
    await build(context)
  } finally {
    await rm(context, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})

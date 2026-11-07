#!/usr/bin/env node
'use strict'

const { cp, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { promisify } = require('node:util')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const run = promisify(execFile)

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

async function main() {
  const outputFile = requestedOutputFile()
  const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
  if (!image || image.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('explicit_decoder_image_required')
  }
  const original = JSON.parse(
    (await run('docker', ['image', 'inspect', image], { maxBuffer: 65536 })).stdout,
  )[0]
  const retainedTag = `bench-intake-media-decoder:${image.slice(7)}`
  await run('docker', ['image', 'tag', image, retainedTag])
  const localTag = `bench-intake-media-probe-base:${randomUUID()}`
  const context = await mkdtemp(join(tmpdir(), 'intake-media-probe-build-'))
  try {
    await run('docker', ['image', 'tag', image, localTag])
    const tagged = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', localTag])
    if (tagged.stdout.trim() !== image) {
      throw new Error('probe_base_identity_changed')
    }
    const source = resolve(__dirname, '../tests/fixtures/media-resource')
    await mkdir(context, { recursive: true })
    for (const name of ['Dockerfile', 'decoder-probe.mjs']) {
      await cp(join(source, name), join(context, name))
    }
    const idFile = join(context, 'image-id')
    await run(
      'docker',
      [
        'build',
        '--network=none',
        '--pull=false',
        '--iidfile',
        idFile,
        '--build-arg',
        `DECODER_IMAGE=${localTag}`,
        context,
      ],
      { maxBuffer: 262144, timeout: 60000 },
    )
    const probe = (await readFile(idFile, 'utf8')).trim()
    if (probe.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(probe)) {
      throw new Error('invalid_probe_image')
    }
    const built = JSON.parse(
      (await run('docker', ['image', 'inspect', probe], { maxBuffer: 65536 })).stdout,
    )[0]
    if (
      JSON.stringify(built.RootFS.Layers.slice(0, original.RootFS.Layers.length)) !==
      JSON.stringify(original.RootFS.Layers)
    ) {
      throw new Error('probe_base_layers_changed')
    }
    if (outputFile) {
      await writeFile(outputFile, `${probe}\n`, { flag: 'wx', mode: 0o600 })
    }
    process.stdout.write(`Test-only media containment image: ${probe}\n`)
  } finally {
    await rm(context, { recursive: true, force: true })
    await run('docker', ['image', 'rm', localTag])
    const retained = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image])
    if (retained.stdout.trim() !== image) {
      throw new Error('production_image_not_retained')
    }
  }
}

main().catch(() => {
  process.stderr.write('Owned containment probe image build failed.\n')
  process.exitCode = 1
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { MEDIA_LIMITS } from '../../../src/media/decoder-protocol.ts'
import { decodeIsolated } from '../../../src/media/decoder-runner.ts'

const run = promisify(execFile)
const MEMORY_LIMIT_BYTES = MEDIA_LIMITS.memoryMiB * 1024 * 1024
const image = process.env.INTAKE_MEDIA_PROBE_IMAGE
if (image && (image.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(image))) {
  throw new Error('explicit_immutable_probe_image_required')
}
const receipts: unknown[] = []
let containmentVerified = false

async function docker(arguments_: string[], timeout = 5000) {
  const result = await run('docker', arguments_, { timeout, maxBuffer: 131072 })
  return result.stdout.trim()
}

function probe(mode: string) {
  assert.ok(image)
  const bytes = Buffer.from(mode)
  return decodeIsolated(image, {
    version: 'media-decode/1',
    digest: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  })
}

async function containers() {
  assert.ok(image)
  const output = await docker(['ps', '-a', '--filter', `ancestor=${image}`, '--format', '{{.ID}}'])
  const ids = output ? output.split('\n') : []
  assert.ok(ids.every((id) => /^[a-f0-9]{12,64}$/.test(id)))
  return ids
}

interface DockerEvent {
  Action: string
  Actor: { ID: string; Attributes: { exitCode?: string } }
}

async function events(): Promise<DockerEvent[]> {
  assert.ok(image)
  const until = new Date(Date.now() + 200).toISOString()
  const output = await docker([
    'events',
    '--since',
    '0',
    '--until',
    until,
    '--filter',
    'type=container',
    '--filter',
    `image=${image}`,
    '--format',
    '{{json .}}',
  ])
  return output
    ? output.split('\n').map((line) => {
        const event = JSON.parse(line)
        assert.equal(typeof event.Action, 'string')
        assert.match(event.Actor.ID, /^[a-f0-9]{64}$/)
        return event
      })
    : []
}

async function newContainerEvents(before: DockerEvent[]) {
  const known = new Set(before.map((event) => event.Actor.ID))
  const observed = (await events()).filter((event) => !known.has(event.Actor.ID))
  const created = observed.filter((event) => event.Action === 'create')
  assert.equal(created.length, 1, 'one owned probe container per invocation')
  return observed.filter((event) => event.Actor.ID === created[0].Actor.ID)
}

async function retainReceipt(receipt: unknown) {
  receipts.push(receipt)
  const path = fileURLToPath(new URL('../../../../.amp/in/artifacts/', import.meta.url))
  await mkdir(path, { recursive: true })
  await writeFile(
    path + '/T05-decoder-resource-receipt.json',
    JSON.stringify({ probe_image: image, cases: receipts }, null, 2) + '\n',
  )
}

function resourceTest(name: string, runCase: () => Promise<void>, needsVerifiedContainment = true) {
  test(
    name,
    { skip: image ? false : 'Explicit test-only INTAKE_MEDIA_PROBE_IMAGE required' },
    async (context) => {
      if (needsVerifiedContainment && !containmentVerified) {
        context.skip('sandbox must be independently verified before resource fault injection')
        return
      }
      await runCase()
    },
  )
}

resourceTest(
  'runtime sandbox has enforced kernel, filesystem and network limits',
  async () => {
    assert.deepEqual(await containers(), [])
    const pending = probe('inspect')
    void pending.catch(() => undefined)
    try {
      let id: string | undefined
      for (let attempt = 0; attempt < 40; attempt++) {
        id = (await containers())[0]
        if (id) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.ok(id, 'owned probe must become observable')
      const inspected = JSON.parse(await docker(['inspect', id]))[0]
      const policy = inspected.HostConfig
      assert.equal(policy.ReadonlyRootfs, true)
      assert.equal(policy.NetworkMode, 'none')
      assert.equal(policy.Memory, MEMORY_LIMIT_BYTES)
      assert.equal(policy.MemorySwap, MEMORY_LIMIT_BYTES)
      assert.equal(policy.NanoCpus, 1000000000)
      assert.equal(policy.PidsLimit, 32)
      assert.deepEqual(policy.CapDrop, ['ALL'])
      assert.ok(policy.SecurityOpt.includes('no-new-privileges'))
      assert.equal(policy.Privileged, false)
      assert.equal(policy.Binds, null)
      assert.equal(inspected.Config.User, '1000:1000')
      assert.match(policy.Tmpfs['/tmp'], /noexec/)
      assert.match(policy.Tmpfs['/tmp'], /nosuid/)
      assert.match(policy.Tmpfs['/tmp'], new RegExp(`(^|,)size=${MEDIA_LIMITS.scratchMiB}m(,|$)`))
      const kernel = JSON.parse(
        await docker([
          'exec',
          id,
          'node',
          '-e',
          "const fs=require('node:fs');console.log(JSON.stringify({memory:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),swap:fs.readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim(),pids:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),interfaces:Object.keys(require('node:os').networkInterfaces()).sort(),routes:fs.readFileSync('/proc/net/route','utf8').trim().split('\\n').slice(1).filter(Boolean).length}))",
        ]),
      )
      assert.deepEqual(kernel, {
        memory: String(MEMORY_LIMIT_BYTES),
        swap: '0',
        pids: '32',
        cpu: '100000 100000',
        interfaces: ['lo'],
        routes: 0,
      })
      assert.equal((await pending).state, 'unsupported')
      assert.deepEqual(await containers(), [])
      containmentVerified = true
      await retainReceipt({
        case: 'runtime sandbox',
        kernel,
        read_only_root: true,
        network: 'none',
        host_mounts: 0,
        user: inspected.Config.User,
      })
    } finally {
      await pending.catch(() => undefined)
    }
  },
  false,
)

resourceTest(
  'native allocation ends with an observed kernel OOM event, not merely exit137',
  async () => {
    const before = await events()
    const started = Date.now()
    await assert.rejects(probe('memory'), /decoder_interrupted/)
    const observed = await newContainerEvents(before)
    assert.ok(
      observed.some((event) => event.Action === 'oom'),
      'kernel must report the owned container OOM',
    )
    const died = observed.find((event) => event.Action === 'die')
    assert.equal(died?.Actor.Attributes.exitCode, '137')
    assert.deepEqual(await containers(), [])
    await retainReceipt({
      case: 'native memory',
      kernel_oom: true,
      exit_code: '137',
      elapsed_ms: Date.now() - started,
    })
  },
)

resourceTest('wall deadline terminates the owned decoder near25seconds without OOM', async () => {
  const before = await events()
  const started = Date.now()
  await assert.rejects(probe('timeout'), /decoder_interrupted/)
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 24000 && elapsed < 36000, `actual wall boundary: ${elapsed}ms`)
  const observed = await newContainerEvents(before)
  assert.equal(
    observed.some((event) => event.Action === 'oom'),
    false,
  )
  assert.deepEqual(await containers(), [])
  await retainReceipt({ case: 'wall deadline', elapsed_ms: elapsed, kernel_oom: false })
})

resourceTest('bounded binary output cancels and reaps the exact owned container', async () => {
  const started = Date.now()
  await assert.rejects(probe('overflow'), /decoder_interrupted/)
  assert.ok(Date.now() - started < 15000)
  assert.deepEqual(await containers(), [])
  await retainReceipt({
    case: 'output ceiling',
    elapsed_ms: Date.now() - started,
    remaining_owned_containers: 0,
  })
})

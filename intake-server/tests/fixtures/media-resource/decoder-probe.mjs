import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { MEDIA_TOOLCHAIN } from '@invimport/contracts/media'
// The probe replaces decoder-main.ts in the decoder image, beside the real protocol limits.
import { MEDIA_LIMITS } from './decoder-protocol.ts'

// Test-only containment probe, deliberately excluded from the production image context.
const chunks = []
for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk))
}
const protocol = Buffer.concat(chunks)
const mode = protocol.subarray(protocol.indexOf(10) + 1).toString('utf8')
if (mode === 'memory') {
  const retained = []
  for (;;) {
    retained.push(Buffer.alloc(64 * 1024 * 1024, 1))
  }
} else if (mode === 'timeout') {
  await new Promise((resolve) => setTimeout(resolve, 60000))
} else if (mode === 'overflow') {
  // Twice the runner's output ceiling, so a broken ceiling fails fast instead of buffering forever.
  const block = Buffer.alloc(1024 * 1024, 1)
  const blocks = Math.ceil((2 * MEDIA_LIMITS.totalOutputBytes) / block.length)
  for (let index = 0; index < blocks; index++) {
    if (!process.stdout.write(block)) {
      await once(process.stdout, 'drain')
    }
  }
} else if (mode === 'inspect') {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  let refused = false
  try {
    await writeFile('/app/forbidden-probe-write', 'must be refused')
  } catch (failure) {
    refused = failure.code === 'EROFS'
  }
  if (!refused) {
    throw new Error('readonly_root_not_enforced')
  }
  await new Promise((resolve) => setTimeout(resolve, 9000))
} else {
  throw new Error('unknown_containment_probe')
}
process.stdout.write(
  JSON.stringify({ state: 'unsupported', toolchain: MEDIA_TOOLCHAIN, pages: [] }) + '\n',
)

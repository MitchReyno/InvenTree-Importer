import { reserveLocalDecoder } from './local-launcher.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { reserveDispatcher, type DecoderWork } from './dispatcher-client.ts'

const active = new AsyncLocalStorage<{
  image: string
  run: (packet: Buffer) => Promise<Buffer>
}>()

/** Admits a complete worker action before it claims a row. Closing an unused offer leaves the row eligible. */
export async function withDecoderAdmission<T>(
  image: string,
  kind: DecoderWork,
  busy: T,
  action: () => Promise<T>,
) {
  const socketPath = process.env.INTAKE_MEDIA_DISPATCH_SOCKET
  const offer = socketPath
    ? await reserveDispatcher(socketPath, image, kind)
    : await reserveLocalDecoder(image, kind)
  if (!offer) {
    return busy
  }
  try {
    return await active.run({ image, run: offer.run }, action)
  } finally {
    offer.release()
  }
}

/** Only the job's pinned image can consume its admission. */
export function reservedLauncher(image: string) {
  const held = active.getStore()
  if (held && image !== held.image) {
    throw new Error('decoder_reservation_image_mismatch')
  }
  return held?.run
}

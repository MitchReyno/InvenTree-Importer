import { launchDecoder } from './docker-decoder.ts'
import { reservedLauncher } from './decoder-admission.ts'
import { requestDecode } from './dispatcher-client.ts'
import { parseDecoderOutput, parseRenditionOutput, parseViewOutput } from './decoder-output.ts'
import {
  checkedInput,
  checkedRenditionInput,
  checkedViewInput,
  type DecodeInput,
  type DecodedMedia,
  type RenditionInput,
  type RenditionResult,
  type ViewInput,
  type ViewResult,
} from '@invimport/media-decoder/protocol'

/** Requires an operator-built immutable image, never a browser-selected image/command. */
export async function decodeIsolated(
  image: string,
  input: DecodeInput,
  dispatch: DispatchOptions = {},
): Promise<DecodedMedia> {
  checkedInput(input)
  const header = { version: input.version, digest: input.digest, recipe: input.recipe ?? null }
  return parseDecoderOutput(await runIsolated(image, header, input.bytes, dispatch))
}

/** Renditions of one retained page PNG, rendered in the same bounded container. */
export async function renderIsolated(
  image: string,
  input: RenditionInput,
): Promise<RenditionResult> {
  checkedRenditionInput(input)
  const header = {
    version: input.version,
    digest: input.digest,
    width: input.width,
    height: input.height,
  }
  return parseRenditionOutput(await runIsolated(image, header, input.bytes), input)
}

/**
 * One view of a retained page PNG: the operator's view and thumbnail, plus the marked preview
 * when marks are given. Runs in the same bounded container, through the dispatcher when set.
 */
export async function renderViewIsolated(
  image: string,
  input: ViewInput,
  dispatch: DispatchOptions = {},
): Promise<ViewResult> {
  checkedViewInput(input)
  const header = {
    version: input.version,
    digest: input.digest,
    width: input.width,
    height: input.height,
    recipe: input.recipe,
    marks: input.marks,
  }
  return parseViewOutput(await runIsolated(image, header, input.bytes, dispatch), input)
}

/** How long a request waits for the dispatcher's slot; see `requestDecode`. */
export interface DispatchOptions {
  busyWaitMs?: number
}

async function runIsolated(
  image: string,
  header: object,
  bytes: Buffer,
  dispatch: DispatchOptions = {},
): Promise<Buffer> {
  if (image.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('immutable_decoder_image_required')
  }
  const packet = Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), bytes])
  const reserved = reservedLauncher(image)
  if (reserved) {
    return reserved(packet)
  }
  const socket = process.env.INTAKE_MEDIA_DISPATCH_SOCKET
  return socket
    ? requestDecode(socket, image, packet, dispatch.busyWaitMs)
    : launchDecoder(image, packet)
}

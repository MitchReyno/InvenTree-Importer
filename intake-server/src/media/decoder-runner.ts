import { launchDecoder } from './docker-decoder.ts'
import { reservedLauncher } from './decoder-admission.ts'
import { requestDecode } from './dispatcher-client.ts'
import {
  parseDecoderOutput,
  parseGridOutput,
  parseLogoMatchOutput,
  parsePreviewOutput,
  parseRenditionOutput,
  parseViewOutput,
} from './decoder-output.ts'
import {
  checkedGridInput,
  checkedInput,
  checkedLogoMatchInput,
  checkedPreviewInput,
  checkedRenditionInput,
  checkedViewInput,
  type DecodeInput,
  type DecodedMedia,
  type GridInput,
  type GridResult,
  type LogoMatchInput,
  type LogoMatchResult,
  type PreviewInput,
  type PreviewResult,
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

/**
 * `preview_images`: recipe `/2` crops on up to four retained page PNGs, rendered as their
 * derivations would be onto one labelled montage. The pages follow the header in order.
 */
export async function previewIsolated(
  image: string,
  input: PreviewInput,
  dispatch: DispatchOptions = {},
): Promise<PreviewResult> {
  checkedPreviewInput(input)
  const { header, pages } = previewPacket(input)
  return parsePreviewOutput(await runIsolated(image, header, pages, dispatch))
}

/** A preview's input header, each page described by its size, and its pages' bytes in order. */
export function previewPacket(input: PreviewInput) {
  const header = {
    version: input.version,
    pages: input.pages.map((page) => ({
      source_version_id: page.source_version_id,
      source_digest: page.source_digest,
      page: page.page,
      digest: page.digest,
      width: page.width,
      height: page.height,
      byte_size: page.bytes.length,
    })),
    crops: input.crops,
  }
  const pages = Buffer.concat(input.pages.map((page) => page.bytes))
  return { header, pages }
}

/** `inspect_region`: a grid labelled in page pixels over one retained page PNG. */
export async function gridIsolated(
  image: string,
  input: GridInput,
  dispatch: DispatchOptions = {},
): Promise<GridResult> {
  checkedGridInput(input)
  const { bytes, ...header } = input
  return parseGridOutput(await runIsolated(image, header, bytes, dispatch))
}

/** `match_logo`: the bundled logo set ranked against a view of one retained page PNG. */
export async function logoMatchIsolated(
  image: string,
  input: LogoMatchInput,
  dispatch: DispatchOptions = {},
): Promise<LogoMatchResult> {
  checkedLogoMatchInput(input)
  const { bytes, ...header } = input
  return parseLogoMatchOutput(await runIsolated(image, header, bytes, dispatch))
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

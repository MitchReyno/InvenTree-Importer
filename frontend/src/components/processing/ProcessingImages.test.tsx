import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi, type Mock } from 'vitest'
import { fixtureScope, render } from '#/test/render'
import { serverQueryKey } from '#/queries/scope'
import { deferred } from '#/test/deferred'
import { createServerQueryClient } from '#/queries/client'
import { ProcessingImages } from './ProcessingImages'
import { IntakeRequestError } from '@invimport/contracts/client'
import type {
  MediaLitViewRecipeDto,
  MediaSnapshotDto,
  ProcessingImageCropDto,
  ProcessingImagesReviewDto,
} from '@invimport/contracts'
import type { MediaClient } from '#/media/types'
import type { ProcessingClient } from '#/processing/types'

type EditMock = Mock<MediaClient['edit']>
type ChatMock = Mock<NonNullable<ProcessingClient['chat']>>

const saved: MediaSnapshotDto = {
  batch_id: 'batch',
  revision: '1',
  attachments: [],
  groups: [],
  derivations: [],
  evidence: [
    {
      id: 'source',
      label: 'Saved packet',
      group_id: null,
      linked_subject_ids: ['lot'],
      versions: [
        {
          id: 'version',
          evidence_id: 'source',
          kind: 'original',
          digest: 'a'.repeat(64),
          byte_size: '10',
          media_type: 'image/png',
          state: 'ready',
          decoder_build: 'fixture',
          recipe: null,
          pages: [{ page: 1, width: 10, height: 10, preview_id: 'preview' }],
        },
      ],
    },
  ],
}

test('Images exposes saved output inspection and Capture link without choosing an attachment', async () => {
  const client = {
    snapshot: vi.fn(async () => saved),
    removalImpact: vi.fn(),
    upload: vi.fn(),
    edit: vi.fn(),
  }
  render(<ProcessingImages batchId="batch" client={client} />)
  expect(await screen.findByRole('heading', { name: 'Saved packet' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open exact original preview' })).toHaveAttribute(
    'href',
    '/api/v1/batches/batch/media/previews/preview',
  )
  expect(screen.getByRole('link', { name: /prepare another crop/ })).toHaveAttribute(
    'href',
    '#batch/capture',
  )
  expect(client.edit).not.toHaveBeenCalled()
  expect(client.upload).not.toHaveBeenCalled()
})

test('failed media reads report unavailable, not an empty successful gallery', async () => {
  const client = {
    snapshot: vi.fn().mockRejectedValue(new Error('offline')),
    upload: vi.fn(),
    removalImpact: vi.fn(),
    edit: vi.fn(),
  }
  render(<ProcessingImages batchId="batch" client={client} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Current media status is unavailable')
  expect(screen.queryByText('No retained images or documents yet.')).not.toBeInTheDocument()
})

test('a help button beside the outputs heading says preparing a crop does not approve it', async () => {
  const user = userEvent.setup()
  const client = {
    snapshot: vi.fn(async () => saved),
    removalImpact: vi.fn(),
    upload: vi.fn(),
    edit: vi.fn(),
  }
  render(<ProcessingImages batchId="batch" client={client} />)
  const heading = screen.getByRole('heading', { name: 'Originals and documentary crops' })

  await user.click(
    within(heading.parentElement!).getByRole('button', { name: 'About image outputs' }),
  )
  expect(await screen.findByRole('dialog', { name: 'About image outputs' })).toHaveTextContent(
    'Preparing a crop does not approve it for inventory.',
  )
})

test('a first visit shows the gallery’s skeleton, not a loading line, until the read lands', async () => {
  const read = deferred<MediaSnapshotDto>()
  const client = {
    snapshot: vi.fn(() => read.promise),
    removalImpact: vi.fn(),
    upload: vi.fn(),
    edit: vi.fn(),
  }
  render(<ProcessingImages batchId="batch" client={client} />)

  expect(screen.queryByText(/Loading retained image outputs/)).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  await act(async () => {
    read.resolve(saved)
    await read.promise
  })
  expect(await screen.findByRole('heading', { name: 'Saved packet' })).toBeVisible()
})

function litRecipe(
  sourceVersionId: string,
  region: { x: number; y: number; width: number; height: number },
  adjustments: Partial<{
    quarter_turns: number
    straighten_millidegrees: number
    page: number
    light: Partial<MediaLitViewRecipeDto['light']>
  }> = {},
): MediaLitViewRecipeDto {
  return {
    version: 'bench-intake-view/2',
    source_version_id: sourceVersionId,
    source_digest: 'b'.repeat(64),
    page: adjustments.page ?? 1,
    page_width: 4000,
    page_height: 6000,
    view: {
      region,
      quarter_turns: adjustments.quarter_turns ?? 0,
      straighten_millidegrees: adjustments.straighten_millidegrees ?? 0,
    },
    light: {
      white_balance: false,
      contrast_clip_permille: null,
      gamma_thousandths: null,
      sharpen: false,
      ...adjustments.light,
    },
  }
}

const partRecipe = litRecipe(
  'version-3011',
  { x: 2210, y: 3120, width: 1400, height: 1400 },
  { quarter_turns: 1, straighten_millidegrees: -3500, light: { white_balance: true } },
)
const stockRecipe = litRecipe('version-3009', { x: 100, y: 200, width: 2400, height: 3000 })
const extraRecipe = litRecipe(
  'version-3010',
  { x: 0, y: 0, width: 2000, height: 2800 },
  { page: 2, light: { gamma_thousandths: 1200, sharpen: true } },
)

function crop(
  index: number,
  role: ProcessingImageCropDto['role'],
  recipe: MediaLitViewRecipeDto,
  evidenceLabel: string,
  more: Partial<ProcessingImageCropDto> = {},
): ProcessingImageCropDto {
  return {
    index,
    role,
    recipe,
    flags: [],
    state: 'ready',
    evidence_id: `evidence-${index}`,
    evidence_label: evidenceLabel,
    document: false,
    ...more,
  }
}

function proposalReview(
  crops: ProcessingImageCropDto[] = [
    crop(1, 'part_image', partRecipe, 'IMG_3011'),
    crop(2, 'stock_image', stockRecipe, 'IMG_3009'),
    crop(3, 'extra', extraRecipe, 'IMG_3010', {
      document: true,
      flags: ['Soft: photographed through the bag'],
    }),
  ],
  more: Partial<ProcessingImagesReviewDto['proposals'][number]> = {},
  selections: ProcessingImagesReviewDto['selections'] = [],
): ProcessingImagesReviewDto {
  return {
    media_revision: '7',
    proposals: [
      {
        proposal_id: 'proposal',
        job_id: 'images-job',
        lot_id: 'lot',
        summary: 'Proposed by Images from 3 photos',
        created_at: '2026-11-27T01:00:00.000Z',
        stale: false,
        crops,
        ...more,
      },
    ],
    selections,
  }
}

// Polled separately, and newer than the review: Confirm never sends its revision.
const mediaAtRevision: MediaSnapshotDto = { ...saved, revision: '9' }

function mountReview(
  review: ProcessingImagesReviewDto,
  {
    edit = vi.fn<MediaClient['edit']>(async () => ({ ...mediaAtRevision, revision: '10' })),
    chat = vi.fn<NonNullable<ProcessingClient['chat']>>(async () => ({
      item_id: 'item',
      seq: '4',
    })),
  }: { edit?: EditMock; chat?: ChatMock } = {},
) {
  const media = {
    snapshot: vi.fn(async () => mediaAtRevision),
    removalImpact: vi.fn(),
    upload: vi.fn(),
    edit,
  }
  const processing = {
    images: vi.fn<(batchId: string) => Promise<ProcessingImagesReviewDto>>(async () => review),
    chat,
  }
  const onDirtyChange = vi.fn()
  const cache = createServerQueryClient()
  render(
    <ProcessingImages
      batchId="batch"
      client={media}
      processing={processing}
      lotLabel={(id) => (id === 'lot' ? 'GE S2CN1 diodes' : undefined)}
      onDirtyChange={onDirtyChange}
    />,
    { cache },
  )

  /** The review is read again and returns this, or fails with it. */
  async function reread(next: ProcessingImagesReviewDto | Error) {
    if (next instanceof Error) {
      processing.images.mockRejectedValue(next)
    } else {
      processing.images.mockResolvedValue(next)
    }
    await act(async () => {
      await cache.invalidateQueries()
    })
  }

  return { media, processing, onDirtyChange, reread, cache }
}

/** The browser finishes loading every crop picture on the page. */
function loadPictures() {
  for (const image of document.querySelectorAll('img[src*="/processing/images/"]')) {
    fireEvent.load(image)
  }
}

async function findCard(name: string) {
  return screen.findByRole('article', { name })
}

async function confirmWhenReady(user: ReturnType<typeof userEvent.setup>, name = 'Confirm images') {
  await screen.findByRole('button', { name })
  loadPictures()

  // The button's element changes when its reason moves between beside and quiet.
  const confirm = () => screen.getByRole('button', { name })

  await vi.waitFor(() => {
    expect(confirm()).toBeEnabled()
    expect(confirm()).not.toHaveAttribute('aria-disabled', 'true')
  })
  await user.click(confirm())
}

test('the Images review shows each proposed crop with its role, source, region, adjustments and flags', async () => {
  const { media, processing } = mountReview(proposalReview())

  expect(await screen.findByRole('heading', { name: 'Images: GE S2CN1 diodes' })).toBeVisible()
  expect(screen.getByText('Proposed by Images from 3 photos')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open session' })).toHaveAttribute(
    'href',
    '#batch/processing/images/sessions/images-job',
  )

  const part = await findCard('Crop 1: Part image')
  expect(within(part).getByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/batches/batch/processing/images/proposal/crops/1/view',
  )
  expect(part).toHaveTextContent('From IMG_3011 · region 2210, 3120, 1400 × 1400')
  expect(within(part).getByText('¼ turn')).toBeVisible()
  expect(within(part).getByText('straightened −3.5°')).toBeVisible()
  expect(within(part).getByText('white balance')).toBeVisible()
  expect(within(part).getByRole('radio', { name: 'Use crop 1 as the Part image' })).toBeChecked()

  const stock = await findCard('Crop 2: Stock image')
  expect(within(stock).getByText('no adjustments')).toBeVisible()
  expect(within(stock).getByRole('checkbox', { name: 'Attach crop 2 to the stock' })).toBeChecked()

  const extra = await findCard('Crop 3: Extra')
  expect(extra).toHaveTextContent('From IMG_3010 · region 0, 0, 2000 × 2800 · page 2')
  expect(within(extra).getByText('gamma 1.20')).toBeVisible()
  expect(within(extra).getByText('sharpened')).toBeVisible()
  expect(within(extra).getByText('Soft: photographed through the bag')).toBeVisible()
  expect(within(extra).queryByRole('checkbox')).not.toBeInTheDocument()
  expect(within(extra).queryByRole('radio')).not.toBeInTheDocument()
  expect(extra).toHaveTextContent(
    'Extras aren’t attached; crop it yourself in Capture to keep one.',
  )

  expect(screen.getByRole('link', { name: 'Crop it yourself in Capture' })).toHaveAttribute(
    'href',
    '#batch/capture',
  )
  expect(screen.getByText(/Nothing is attached until you confirm\./)).toBeVisible()
  expect(media.edit).not.toHaveBeenCalled()
  expect(processing.chat).not.toHaveBeenCalled()
})

test('confirming sends one select_images edit with the Part image and the stock image, not the extra', async () => {
  const user = userEvent.setup()
  const { media } = mountReview(proposalReview())

  await confirmWhenReady(user)

  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit).toHaveBeenCalledWith(
    'batch',
    {
      expected_revision: '7',
      change: {
        kind: 'select_images',
        subject_id: 'lot',
        part_image: partRecipe,
        stock_images: [stockRecipe],
      },
    },
    expect.any(String),
  )
  expect(await screen.findByRole('status', { name: 'Images confirmation' })).toHaveTextContent(
    'Confirmed.',
  )
})

test('nothing is sent until Confirm, and changed choices hold the navigation guard', async () => {
  const user = userEvent.setup()
  const { media, processing, onDirtyChange } = mountReview(proposalReview())
  const stock = await findCard('Crop 2: Stock image')

  await user.click(within(stock).getByRole('checkbox', { name: 'Attach crop 2 to the stock' }))
  await user.click(screen.getByRole('radio', { name: 'No Part image' }))

  expect(onDirtyChange).toHaveBeenLastCalledWith(true, expect.anything())
  expect(media.edit).not.toHaveBeenCalled()
  expect(processing.chat).not.toHaveBeenCalled()
})

test('an unchecked stock image is not sent', async () => {
  const user = userEvent.setup()
  const { media } = mountReview(proposalReview())
  const stock = await findCard('Crop 2: Stock image')

  await user.click(within(stock).getByRole('checkbox', { name: 'Attach crop 2 to the stock' }))
  await confirmWhenReady(user)

  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].change).toEqual({
    kind: 'select_images',
    subject_id: 'lot',
    part_image: partRecipe,
    stock_images: [],
  })
})

test('choosing No Part image sends no Part image, and a confirmed save releases the guard', async () => {
  const user = userEvent.setup()
  const { media, onDirtyChange } = mountReview(proposalReview())

  await user.click(await screen.findByRole('radio', { name: 'No Part image' }))
  await confirmWhenReady(user)

  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].change).toMatchObject({
    part_image: null,
    stock_images: [stockRecipe],
  })
  await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
})

test('a confirmed selection is shown as confirmed and the choices start from it', async () => {
  const user = userEvent.setup()
  // The read may order a recipe's fields differently; the match is by value.
  const { light, view, ...rest } = partRecipe
  const reordered = JSON.parse(JSON.stringify({ light, view, ...rest })) as MediaLitViewRecipeDto
  const { media } = mountReview(
    proposalReview(undefined, undefined, [
      {
        lot_id: 'lot',
        revision: '6',
        part_image: { version_id: 'derived-part', recipe: reordered, state: 'queued' },
        stock_images: [],
      },
    ]),
  )

  const part = await findCard('Crop 1: Part image')
  expect(part).toHaveTextContent('Confirmed as the Part image · preparing')
  const stock = await findCard('Crop 2: Stock image')
  expect(
    within(stock).getByRole('checkbox', { name: 'Attach crop 2 to the stock' }),
  ).not.toBeChecked()

  await confirmWhenReady(user)
  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].change).toMatchObject({
    part_image: partRecipe,
    stock_images: [],
  })
})

test('a confirmed stock image names its place among the stock images', async () => {
  mountReview(
    proposalReview(undefined, undefined, [
      {
        lot_id: 'lot',
        revision: '6',
        part_image: null,
        stock_images: [
          { version_id: 'other', recipe: extraRecipe, state: 'ready' },
          { version_id: 'derived-stock', recipe: stockRecipe, state: 'ready' },
        ],
      },
    ]),
  )

  expect(await findCard('Crop 2: Stock image')).toHaveTextContent(
    'Confirmed as stock image 2 · ready',
  )
  expect(screen.getByRole('radio', { name: 'No Part image' })).toBeChecked()
})

test('preparing, failed and removed crops show why in place of the picture and request none', async () => {
  mountReview(
    proposalReview([
      crop(1, 'part_image', partRecipe, 'IMG_3011', { state: 'preparing' }),
      crop(2, 'stock_image', stockRecipe, 'IMG_3009', { state: 'failed' }),
      crop(3, 'extra', extraRecipe, 'IMG_3010', { state: 'removed' }),
    ]),
  )

  const part = await findCard('Crop 1: Part image')
  expect(part).toHaveTextContent('Rendering…')
  expect(within(part).queryByRole('img')).not.toBeInTheDocument()
  expect(within(part).getByRole('radio', { name: 'Use crop 1 as the Part image' })).toBeDisabled()
  expect(screen.getByRole('radio', { name: 'No Part image' })).toBeChecked()
  const stock = await findCard('Crop 2: Stock image')
  expect(stock).toHaveTextContent('Couldn’t render this crop')
  expect(within(stock).queryByRole('img')).not.toBeInTheDocument()
  expect(within(stock).getByRole('checkbox', { name: 'Attach crop 2 to the stock' })).toBeDisabled()
  const extra = await findCard('Crop 3: Extra')
  expect(extra).toHaveTextContent('Photo removed from Capture')
  expect(within(extra).queryByRole('img')).not.toBeInTheDocument()
  expect(document.querySelectorAll('img[src*="/processing/images/"]')).toHaveLength(0)
})

test('a stale proposal says it is out of date and can still be confirmed', async () => {
  const user = userEvent.setup()
  const { media } = mountReview(proposalReview(undefined, { stale: true }))

  expect(
    await screen.findByText('Out of date: the lot changed since this was proposed'),
  ).toBeVisible()
  await confirmWhenReady(user)
  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
})

test('only the newest proposal for a lot is shown', async () => {
  const review = proposalReview()
  const older = {
    ...review.proposals[0],
    proposal_id: 'older',
    summary: 'An earlier proposal',
    created_at: '2026-11-26T01:00:00.000Z',
  }
  mountReview({ ...review, proposals: [...review.proposals, older] })

  expect(await screen.findByText('Proposed by Images from 3 photos')).toBeVisible()
  expect(screen.queryByText('An earlier proposal')).not.toBeInTheDocument()
  expect(screen.getAllByRole('heading', { name: /^Images: / })).toHaveLength(1)
})

test('asking Images to redo one sends a chat message naming the crop to the proposal’s session', async () => {
  const user = userEvent.setup()
  const { processing, media } = mountReview(proposalReview())

  await user.click(await screen.findByRole('button', { name: 'Ask Images to redo one' }))
  const form = screen.getByRole('form', { name: 'Ask Images to redo a crop' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Crop' }), '2')
  await user.type(
    within(form).getByRole('textbox', { name: 'What to change (optional)' }),
    'keep the whole label in frame',
  )
  const send = within(form).getByRole('button', { name: 'Send to Images' })
  await vi.waitFor(() => expect(send).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(send)

  await vi.waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(1))
  const [batchId, jobId, input, key] = processing.chat.mock.calls[0]
  expect(batchId).toBe('batch')
  expect(jobId).toBe('images-job')
  expect(input).toEqual({
    idempotency_key: key,
    text: 'Please redo crop 2 of proposal proposal (Stock image, from IMG_3009 · region 100, 200, 2400 × 3000 · page 1): keep the whole label in frame',
  })
  expect(await screen.findByRole('status', { name: 'Redo request' })).toHaveTextContent(
    'Sent to Images',
  )
  expect(media.edit).not.toHaveBeenCalled()
})

test('a redo request that fails says so and keeps what was written', async () => {
  const user = userEvent.setup()
  const chat: ChatMock = vi.fn()
  chat.mockRejectedValue(new IntakeRequestError(409, 'session_closed'))
  mountReview(proposalReview(), { chat })

  await user.click(await screen.findByRole('button', { name: 'Ask Images to redo one' }))
  const form = screen.getByRole('form', { name: 'Ask Images to redo a crop' })
  const text = within(form).getByRole('textbox', { name: 'What to change (optional)' })
  await user.type(text, 'less glare')
  const send = within(form).getByRole('button', { name: 'Send to Images' })
  await vi.waitFor(() => expect(send).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(send)

  expect(await within(form).findByRole('alert')).toHaveTextContent('Couldn’t send')
  expect(text).toHaveValue('less glare')
})

test('a failed confirm keeps the operator’s choices and says what happened', async () => {
  const user = userEvent.setup()
  const edit: EditMock = vi.fn()
  edit.mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  const { onDirtyChange } = mountReview(proposalReview(), { edit })
  const stock = await findCard('Crop 2: Stock image')
  const attach = within(stock).getByRole('checkbox', { name: 'Attach crop 2 to the stock' })

  await user.click(attach)
  await confirmWhenReady(user)

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Capture changed since these were shown',
  )
  expect(attach).not.toBeChecked()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true, expect.anything())
})

test('a failed Images read says so rather than showing no proposals', async () => {
  const media = {
    snapshot: vi.fn(async () => mediaAtRevision),
    removalImpact: vi.fn(),
    upload: vi.fn(),
    edit: vi.fn(),
  }
  const processing = { images: vi.fn().mockRejectedValue(new Error('offline')), chat: vi.fn() }
  render(<ProcessingImages batchId="batch" client={media} processing={processing} />)

  expect(await screen.findByText('Proposed crops are unavailable right now.')).toBeVisible()
  expect(screen.queryByText(/hasn’t proposed any crops/)).not.toBeInTheDocument()
})

test('with no proposals the review says Images has proposed none yet', async () => {
  mountReview({ media_revision: '7', proposals: [], selections: [] })

  expect(await screen.findByText('Images hasn’t proposed any crops yet.')).toBeVisible()
})

test('an empty confirmed selection means none were kept, so the defaults don’t come back', async () => {
  mountReview(
    proposalReview(undefined, undefined, [
      { lot_id: 'lot', revision: '6', part_image: null, stock_images: [] },
    ]),
  )

  expect(await screen.findByRole('radio', { name: 'No Part image' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Attach crop 2 to the stock' })).not.toBeChecked()
})

test('confirm names the media revision the choices were made on, so a later change conflicts', async () => {
  const user = userEvent.setup()
  const edit: EditMock = vi.fn()
  edit.mockRejectedValueOnce(new IntakeRequestError(412, 'revision_conflict'))
  edit.mockResolvedValue({ ...mediaAtRevision, revision: '10' })
  const { media, reread } = mountReview(proposalReview(), { edit })

  await user.click(
    within(await findCard('Crop 2: Stock image')).getByRole('checkbox', {
      name: 'Attach crop 2 to the stock',
    }),
  )
  // Another tab confirms meanwhile; this tab's next read is at the newer revision.
  await reread({
    ...proposalReview(undefined, undefined, [
      {
        lot_id: 'lot',
        revision: '8',
        part_image: null,
        stock_images: [{ version_id: 'other-tab', recipe: stockRecipe, state: 'ready' }],
      },
    ]),
    media_revision: '8',
  })
  await confirmWhenReady(user)

  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].expected_revision).toBe('7')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Capture changed since these were shown',
  )
  expect(screen.getByRole('checkbox', { name: 'Attach crop 2 to the stock' })).not.toBeChecked()

  await user.click(screen.getByRole('button', { name: 'Check my choices against the latest' }))
  await confirmWhenReady(user)
  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(2))
  expect(media.edit.mock.calls[1][1]).toMatchObject({
    expected_revision: '8',
    change: { stock_images: [] },
  })
})

test('Confirm sends nothing while the proposed crops read has failed', async () => {
  const user = userEvent.setup()
  const { media, reread } = mountReview(proposalReview())
  await screen.findByRole('button', { name: 'Confirm images' })
  loadPictures()

  const confirm = () => screen.getByRole('button', { name: 'Confirm images' })

  await vi.waitFor(() => expect(confirm()).not.toHaveAttribute('aria-disabled', 'true'))
  expect(confirm()).toBeEnabled()

  await reread(new Error('offline'))
  expect(await screen.findByText('Proposed crops are unavailable right now.')).toBeVisible()
  expect(confirm()).toHaveAttribute('aria-disabled', 'true')
  await user.click(confirm())

  expect(media.edit).not.toHaveBeenCalled()
})

const newerReview = (): ProcessingImagesReviewDto => {
  const review = proposalReview()
  return {
    ...review,
    proposals: [
      {
        ...review.proposals[0],
        proposal_id: 'proposal-2',
        job_id: 'images-job-2',
        summary: 'A newer proposal',
        created_at: '2026-11-27T02:00:00.000Z',
      },
    ],
  }
}

test('a newer proposal waits behind unconfirmed choices until the operator lets them go', async () => {
  const user = userEvent.setup()
  const { onDirtyChange, reread } = mountReview(proposalReview())

  await user.click(
    within(await findCard('Crop 2: Stock image')).getByRole('checkbox', {
      name: 'Attach crop 2 to the stock',
    }),
  )
  await reread(newerReview())

  expect(await screen.findByText(/Images has proposed newer crops for this lot/)).toBeVisible()
  expect(screen.getByText('Proposed by Images from 3 photos')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Attach crop 2 to the stock' })).not.toBeChecked()

  await user.click(screen.getByRole('button', { name: 'Show the newer proposal' }))
  expect(screen.getByText('A newer proposal')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Attach crop 2 to the stock' })).toBeChecked()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a newer proposal replaces one with no choices made', async () => {
  const { reread } = mountReview(proposalReview())
  await findCard('Crop 1: Part image')

  await reread(newerReview())

  expect(await screen.findByText('A newer proposal')).toBeVisible()
  expect(screen.queryByText(/proposed newer crops/)).not.toBeInTheDocument()
})

test('an unconfirmed redo request survives closing its form and a newer proposal, and retries exactly', async () => {
  const user = userEvent.setup()
  const chat: ChatMock = vi.fn()
  chat.mockRejectedValueOnce(new TypeError('connection reset'))
  chat.mockResolvedValue({ item_id: 'item', seq: '5' })
  const { reread } = mountReview(proposalReview(), { chat })

  await user.click(await screen.findByRole('button', { name: 'Ask Images to redo one' }))
  const form = screen.getByRole('form', { name: 'Ask Images to redo a crop' })
  await user.type(
    within(form).getByRole('textbox', { name: 'What to change (optional)' }),
    'less glare',
  )
  const send = within(form).getByRole('button', { name: 'Send to Images' })
  await vi.waitFor(() => expect(send).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(send)
  expect(await within(form).findByRole('alert')).toHaveTextContent('Couldn’t send for certain')

  await user.click(within(form).getByRole('button', { name: 'Close' }))
  expect(screen.getByText(/A redo request isn’t confirmed yet/)).toBeVisible()
  await reread(newerReview())
  await user.click(screen.getByRole('button', { name: 'Ask Images to redo one' }))
  const reopened = screen.getByRole('form', { name: 'Ask Images to redo a crop' })
  const retry = within(reopened).getByRole('button', { name: 'Retry' })
  await vi.waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(retry)

  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(2))
  expect(chat.mock.calls[1]).toEqual(chat.mock.calls[0])
  expect(chat.mock.calls[1][1]).toBe('images-job')
  expect(await screen.findByRole('status', { name: 'Redo request' })).toHaveTextContent(
    'Sent to Images',
  )
})

test('a chosen crop that stops rendering blocks Confirm until it is unticked', async () => {
  const user = userEvent.setup()
  const { media, reread } = mountReview(proposalReview())

  await user.click(await screen.findByRole('radio', { name: 'No Part image' }))
  await reread(
    proposalReview([
      crop(1, 'part_image', partRecipe, 'IMG_3011'),
      crop(2, 'stock_image', stockRecipe, 'IMG_3009', { state: 'failed' }),
    ]),
  )
  const stock = within(await findCard('Crop 2: Stock image')).getByRole('checkbox', {
    name: 'Attach crop 2 to the stock',
  })
  await vi.waitFor(() => expect(stock).toHaveAccessibleDescription(/couldn’t render it/))
  expect(screen.getByRole('button', { name: 'Confirm images' })).toBeDisabled()
  expect(screen.getByText(/Untick crop 2/)).toBeVisible()

  await user.click(stock)
  await confirmWhenReady(user, 'Confirm no images')
  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].change).toMatchObject({ part_image: null, stock_images: [] })
})

test('a chosen crop can’t be confirmed until its picture has loaded', async () => {
  const user = userEvent.setup()
  const { media } = mountReview(proposalReview())
  const part = await findCard('Crop 1: Part image')
  const confirm = screen.getByRole('button', { name: 'Confirm images' })

  expect(confirm).toBeDisabled()
  expect(screen.getByText(/crop 1 and crop 2.*loaded/)).toBeVisible()
  // A picture that fails to load can still be unticked.
  fireEvent.error(within(part).getByRole('img'))
  await user.click(screen.getByRole('radio', { name: 'No Part image' }))
  const stock = await findCard('Crop 2: Stock image')
  fireEvent.load(within(stock).getByRole('img'))

  const ready = () => screen.getByRole('button', { name: 'Confirm images' })

  await vi.waitFor(() => expect(ready()).toBeEnabled())
  await vi.waitFor(() => expect(ready()).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(ready())
  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].change).toMatchObject({
    part_image: null,
    stock_images: [stockRecipe],
  })
})

test('a confirmed Part image matches only a Part image crop, and confirming says it removes it', async () => {
  const user = userEvent.setup()
  const { media } = mountReview(
    proposalReview(undefined, undefined, [
      {
        lot_id: 'lot',
        revision: '6',
        part_image: { version_id: 'derived-part', recipe: extraRecipe, state: 'ready' },
        stock_images: [{ version_id: 'derived-stock', recipe: stockRecipe, state: 'ready' }],
      },
    ]),
  )

  const extra = await findCard('Crop 3: Extra')
  expect(extra).not.toHaveTextContent('Confirmed as')
  expect(screen.getByRole('radio', { name: 'No Part image' })).toBeChecked()
  expect(screen.getByText('Confirming removes the confirmed Part image.')).toBeVisible()

  await user.click(
    within(await findCard('Crop 2: Stock image')).getByRole('checkbox', {
      name: 'Attach crop 2 to the stock',
    }),
  )
  expect(
    screen.getByText('Confirming removes the confirmed Part image and stock image 1.'),
  ).toBeVisible()
  await confirmWhenReady(user, 'Confirm no images')
  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].change).toMatchObject({ part_image: null, stock_images: [] })
})

test('a redo draft stays on the proposal it started on until the operator retargets it', async () => {
  const user = userEvent.setup()
  const { processing, reread } = mountReview(proposalReview())

  await user.click(await screen.findByRole('button', { name: 'Ask Images to redo one' }))
  const form = screen.getByRole('form', { name: 'Ask Images to redo a crop' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Crop' }), '2')
  await user.type(
    within(form).getByRole('textbox', { name: 'What to change (optional)' }),
    'tighter',
  )
  const newer = newerReview()
  newer.proposals[0].crops = [crop(1, 'stock_image', stockRecipe, 'IMG_4000')]
  await reread(newer)

  expect(await within(form).findByText(/written for the earlier proposal/)).toBeVisible()
  const send = within(form).getByRole('button', { name: 'Send to Images' })
  await vi.waitFor(() => expect(send).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(send)
  await vi.waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(1))
  expect(processing.chat.mock.calls[0][1]).toBe('images-job')
  expect(processing.chat.mock.calls[0][2].text).toBe(
    'Please redo crop 2 of proposal proposal (Stock image, from IMG_3009 · region 100, 200, 2400 × 3000 · page 1): tighter',
  )

  await user.type(within(form).getByRole('textbox', { name: 'What to change (optional)' }), 'again')
  await user.click(within(form).getByRole('button', { name: 'Use the newer proposal' }))
  expect(within(form).getByRole('textbox', { name: 'What to change (optional)' })).toHaveValue(
    'again',
  )
  await user.click(within(form).getByRole('button', { name: 'Send to Images' }))
  await vi.waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(2))
  expect(processing.chat.mock.calls[1][1]).toBe('images-job-2')
  expect(processing.chat.mock.calls[1][2].text).toBe(
    'Please redo crop 1 of proposal proposal-2 (Stock image, from IMG_4000 · region 100, 200, 2400 × 3000 · page 1): again',
  )
})

test('an uncertain confirmation retries exactly even after a chosen crop stops rendering', async () => {
  const user = userEvent.setup()
  const edit: EditMock = vi.fn()
  edit.mockRejectedValueOnce(new TypeError('connection reset'))
  edit.mockResolvedValue({ ...mediaAtRevision, revision: '10' })
  const { media, reread, cache } = mountReview(proposalReview(), { edit })

  await confirmWhenReady(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('isn’t certain')
  await reread(
    proposalReview([
      crop(1, 'part_image', partRecipe, 'IMG_3011', { state: 'removed' }),
      crop(2, 'stock_image', stockRecipe, 'IMG_3009'),
    ]),
  )
  // The media has moved on since; the replayed receipt mustn't replace the newer read.
  const mediaKey = serverQueryKey(fixtureScope, 'media', 'batch')
  cache.setQueryData(mediaKey, { ...mediaAtRevision, revision: '12' })
  const nextRead = deferred<MediaSnapshotDto>()
  media.snapshot.mockImplementation(() => nextRead.promise)
  const readsBefore = media.snapshot.mock.calls.length

  const retry = screen.getByRole('button', { name: 'Retry confirm' })
  expect(retry).toBeEnabled()
  await user.click(retry)

  await vi.waitFor(() => expect(edit).toHaveBeenCalledTimes(2))
  expect(edit.mock.calls[1]).toEqual(edit.mock.calls[0])
  // The reads after it are still landing; the cache keeps the newer read, not the receipt.
  await vi.waitFor(() => expect(media.snapshot.mock.calls.length).toBeGreaterThan(readsBefore))
  expect(cache.getQueryData<MediaSnapshotDto>(mediaKey)?.revision).toBe('12')
  await act(async () => {
    nextRead.resolve({ ...mediaAtRevision, revision: '12' })
    await nextRead.promise
  })
  await vi.waitFor(() =>
    expect(screen.getByRole('status', { name: 'Images confirmation' })).toHaveTextContent(
      'Confirmed.',
    ),
  )
})

test('a default confirmation in flight holds the navigation guard until its receipt lands', async () => {
  const user = userEvent.setup()
  const reply = deferred<MediaSnapshotDto>()
  const edit: EditMock = vi.fn(() => reply.promise)
  const { onDirtyChange } = mountReview(proposalReview(), { edit })

  await confirmWhenReady(user)

  expect(edit).toHaveBeenCalledTimes(1)
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await act(async () => {
    reply.resolve({ ...mediaAtRevision, revision: '10' })
    await reply.promise
  })
  await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
})

test('an uncertain default confirmation keeps the guard, unnamed, until it is abandoned', async () => {
  const user = userEvent.setup()
  const edit: EditMock = vi.fn()
  edit.mockRejectedValue(new TypeError('connection reset'))
  const { onDirtyChange } = mountReview(proposalReview(), { edit })

  await confirmWhenReady(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('isn’t certain')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)

  await user.click(screen.getByRole('button', { name: 'Discard request' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(true, expect.anything())
})

test('a blank redo in flight holds the navigation guard until its receipt lands', async () => {
  const user = userEvent.setup()
  const reply = deferred<{ item_id: string; seq: string }>()
  const chat: ChatMock = vi.fn(() => reply.promise)
  const { onDirtyChange } = mountReview(proposalReview(), { chat })

  await user.click(await screen.findByRole('button', { name: 'Ask Images to redo one' }))
  const send = screen.getByRole('button', { name: 'Send to Images' })
  await vi.waitFor(() => expect(send).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(send)

  expect(chat).toHaveBeenCalledTimes(1)
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await act(async () => {
    reply.resolve({ item_id: 'item', seq: '5' })
    await reply.promise
  })
  await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
})

test('a proposal whose crops are still rendering can’t be confirmed as empty by default', async () => {
  const user = userEvent.setup()
  const { media } = mountReview(
    proposalReview([
      crop(1, 'part_image', partRecipe, 'IMG_3011', { state: 'preparing' }),
      crop(2, 'stock_image', stockRecipe, 'IMG_3009', { state: 'preparing' }),
    ]),
  )

  await findCard('Crop 1: Part image')
  expect(screen.getByRole('button', { name: 'Confirm images' })).toBeDisabled()
  expect(screen.getByText(/still rendering/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Confirm images' }))
  expect(media.edit).not.toHaveBeenCalled()
})

test('confirming no images is an explicit act with its own label', async () => {
  const user = userEvent.setup()
  const { media } = mountReview(
    proposalReview(undefined, undefined, [
      { lot_id: 'lot', revision: '6', part_image: null, stock_images: [] },
    ]),
  )

  await findCard('Crop 1: Part image')
  expect(screen.getByRole('button', { name: 'Confirm images' })).toBeDisabled()
  expect(screen.getByText(/Choose the images to confirm/)).toBeVisible()

  await user.click(screen.getByRole('radio', { name: 'Use crop 1 as the Part image' }))
  await user.click(screen.getByRole('radio', { name: 'No Part image' }))
  await confirmWhenReady(user, 'Confirm no images')
  await vi.waitFor(() => expect(media.edit).toHaveBeenCalledTimes(1))
  expect(media.edit.mock.calls[0][1].change).toMatchObject({ part_image: null, stock_images: [] })
})

test('a redo names the proposal and the crop’s region, so two proposals from one session differ', async () => {
  const user = userEvent.setup()
  const { processing, reread } = mountReview(proposalReview())

  await user.click(await screen.findByRole('button', { name: 'Ask Images to redo one' }))
  const form = screen.getByRole('form', { name: 'Ask Images to redo a crop' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Crop' }), '2')
  const later = newerReview()
  later.proposals[0].job_id = 'images-job'
  later.proposals[0].crops = [
    crop(1, 'part_image', partRecipe, 'IMG_3011'),
    crop(
      2,
      'stock_image',
      litRecipe('version-3009', { x: 900, y: 50, width: 1000, height: 1200 }),
      'IMG_3009',
    ),
  ]
  await reread(later)
  const send = within(form).getByRole('button', { name: 'Send to Images' })
  await vi.waitFor(() => expect(send).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(send)
  await vi.waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(1))
  await user.click(within(form).getByRole('button', { name: 'Use the newer proposal' }))
  await user.click(within(form).getByRole('button', { name: 'Send to Images' }))
  await vi.waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(2))

  const [first, second] = processing.chat.mock.calls.map((call) => call[2].text)
  expect(first).toBe(
    'Please redo crop 2 of proposal proposal (Stock image, from IMG_3009 · region 100, 200, 2400 × 3000 · page 1).',
  )
  expect(second).toBe(
    'Please redo crop 2 of proposal proposal-2 (Stock image, from IMG_3009 · region 900, 50, 1000 × 1200 · page 1).',
  )
})

import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { MediaSnapshotDto, ProcessingQuestionFigureDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { F, figure, wornSuffixFigures } from '#/test/question-figures'
import { Q } from '#/test/answered-questions'
import { questionFigureImage } from '#/media/types'
import { batchHref } from '#/navigation/batch-route'
import type { MediaClient } from '#/media/types'
import { QuestionFigures } from './QuestionFigures'

const captureHref = batchHref(F.batch, { tab: 'capture' })
const questionId = Q.question(7)

function show(figures: ProcessingQuestionFigureDto[], clients = {}) {
  render(
    <QuestionFigures
      figures={figures}
      batchId={F.batch}
      jobId={Q.job}
      questionId={questionId}
      questionTitle="Which ATmega328P variant is this?"
      lot="Lot 7"
      captureHref={captureHref}
    />,
    { clients },
  )
}

const image = (index: number, size: 'view' | 'thumb' = 'view') =>
  questionFigureImage(F.batch, Q.job, questionId, index, size)

function marksIn(element: HTMLElement) {
  return element.querySelector('svg[data-figure-marks]')
}

test('one picture fills the card with its caption, source line and marks over it', () => {
  show([wornSuffixFigures()[0]])

  const open = screen.getByRole('button', { name: 'Open picture 1 of 1: The worn suffix, boxed' })
  const picture = open.querySelector('img')
  // Marks are an overlay: the image is the route's plain view, never a marked render.
  expect(picture).toHaveAttribute('src', image(1))
  const marks = marksIn(open)
  expect(marks).not.toBeNull()
  expect(marks!.querySelector('rect')).not.toBeNull()
  const labels = Array.from(marks!.querySelectorAll('text'), (text) => text.textContent)
  expect(labels).toEqual(['the suffix in doubt', 'Worn: B or nothing?'])
  const caption = screen.getByText('The worn suffix, boxed').closest('figcaption')
  expect(caption).toHaveTextContent('IMG_3020 · cropped, turned upright, ×3.4')
  expect(screen.queryByRole('group', { name: 'Pictures' })).not.toBeInTheDocument()
})

test('every labelled mark shows its label, as the agent’s preview draws it', () => {
  show([
    figure(1, {
      marks: [
        {
          kind: 'arrow',
          geometry: { from: { x: 1000, y: 1000 }, to: { x: 5000, y: 5000 } },
          label: 'pin 1',
        },
        { kind: 'circle', geometry: { x: 2000, y: 2000, width: 1000, height: 1000 }, label: 'dot' },
        {
          kind: 'ellipse',
          geometry: { x: 6000, y: 2000, width: 2000, height: 1000 },
          label: 'logo',
        },
        {
          kind: 'highlight',
          geometry: { x: 500, y: 7000, width: 9000, height: 1000 },
          label: 'code',
        },
        { kind: 'box', geometry: { x: 7000, y: 8000, width: 2000, height: 2000 } },
      ],
    }),
  ])

  const marks = marksIn(screen.getByRole('button', { name: /^Open picture 1 of 1/ }))
  const labels = Array.from(marks!.querySelectorAll('text'), (text) => text.textContent)
  expect(labels).toEqual(['pin 1', 'dot', 'logo', 'code'])
})

test('a label wider than a narrow picture takes a smaller size so all of it shows', () => {
  show([
    figure(1, {
      view: {
        region: { x: 1840, y: 1210, width: 100, height: 600 },
        quarter_turns: 0,
        straighten_millidegrees: 0,
      },
      marks: [
        { kind: 'label', at: { x: 5000, y: 2000 }, label: 'Short' },
        { kind: 'label', at: { x: 5000, y: 8000 }, label: 'W'.repeat(40) },
      ],
    }),
  ])

  const marks = marksIn(screen.getByRole('button', { name: /^Open picture 1 of 1/ }))!
  const viewWidth = Number(marks.getAttribute('viewBox')!.split(' ')[2])
  const [short, long] = Array.from(marks.querySelectorAll('text'))
  expect(Number(long.getAttribute('font-size'))).toBeLessThan(
    Number(short.getAttribute('font-size')),
  )
  for (const pill of Array.from(marks.querySelectorAll('rect.pill'))) {
    const x = Number(pill.getAttribute('x'))
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x + Number(pill.getAttribute('width'))).toBeLessThanOrEqual(viewWidth)
  }
})

test('two pictures sit side by side, badged A and B', () => {
  show([
    figure(2, { caption: 'Packet A: date code 2341' }),
    figure(5, { caption: 'Packet B: date code 2407' }),
  ])

  const first = screen.getByRole('button', {
    name: 'Open picture 1 of 2: Packet A: date code 2341',
  })
  const second = screen.getByRole('button', {
    name: 'Open picture 2 of 2: Packet B: date code 2407',
  })
  expect(first).toHaveTextContent('A')
  expect(second).toHaveTextContent('B')
  expect(first.querySelector('img')).toHaveAttribute('src', image(1))
  expect(second.querySelector('img')).toHaveAttribute('src', image(2))
  expect(screen.getByRole('group', { name: '2 pictures for this question' })).toHaveAttribute(
    'data-layout',
    'pair',
  )
})

test('three to five show one large with a thumbnail strip the arrow keys move along', async () => {
  show(wornSuffixFigures())

  const gallery = screen.getByRole('group', { name: '4 pictures for this question' })
  expect(gallery).toHaveAttribute('data-layout', 'strip')
  expect(screen.getAllByRole('button', { name: /^Open picture/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: /^Open picture 1 of 4/ })).toHaveTextContent('1 / 4')
  const strip = screen.getByRole('group', { name: 'Pictures' })
  const thumbs = within(strip).getAllByRole('button')
  expect(thumbs).toHaveLength(4)
  expect(thumbs[0]).toHaveAttribute('aria-current', 'true')
  expect(thumbs[1].querySelector('img')).toHaveAttribute('src', image(2, 'thumb'))

  thumbs[0].focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(thumbs[1]).toHaveAttribute('aria-current', 'true')
  expect(thumbs[0]).not.toHaveAttribute('aria-current')
  expect(thumbs[1]).toHaveFocus()
  expect(
    screen.getByRole('button', { name: 'Open picture 2 of 4: The slip, line 3' }),
  ).toBeVisible()

  await userEvent.keyboard('{ArrowRight}')
  // A document page carries its page badge.
  expect(screen.getByRole('button', { name: /^Open picture 3 of 4/ })).toHaveTextContent('p. 12')
  await userEvent.keyboard('{ArrowLeft}')
  expect(thumbs[1]).toHaveAttribute('aria-current', 'true')

  await userEvent.click(thumbs[3])
  expect(screen.getByRole('button', { name: /^Open picture 4 of 4/ })).toBeVisible()
  expect(screen.getByText('The whole board').closest('figcaption')).toHaveTextContent(
    'IMG_3023 · the whole page',
  )
})

test('a removed, preparing or failed picture says so while the others show', () => {
  show([figure(1, { caption: 'Ready' }), figure(2, { caption: 'Removed', state: 'removed' })])

  const removed = screen.getByRole('button', { name: 'Open picture 2 of 2: Removed' })
  expect(removed).toHaveTextContent('Photo removed')
  expect(removed).toHaveAccessibleDescription('Photo removed')
  expect(removed.querySelector('img')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Open picture 1 of 2: Ready' }).querySelector('img'),
  ).not.toBeNull()
})

test('a picture still being made, or one that couldn’t be made, shows in its place', () => {
  show([
    figure(1, { caption: 'Preparing', state: 'preparing' }),
    figure(2, { caption: 'Failed', state: 'failed' }),
  ])

  expect(screen.getByRole('button', { name: /Preparing$/ })).toHaveTextContent('Preparing picture…')
  expect(screen.getByRole('button', { name: /Failed$/ })).toHaveTextContent(
    'Picture couldn’t be made',
  )
  expect(document.querySelectorAll('img')).toHaveLength(0)
})

test('a picture that fails to load is tried again, and says so only after its retries', () => {
  vi.useFakeTimers()
  try {
    show([figure(1, { caption: 'Flaky' })])
    const open = screen.getByRole('button', { name: 'Open picture 1 of 1: Flaky' })

    const picture = () => open.querySelector('img')

    fireEvent.error(picture()!)
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(picture()).toHaveAttribute('src', `${image(1)}?retry=1`)

    for (const [retry, wait] of [
      [2, 4_000],
      [3, 6_000],
    ]) {
      fireEvent.error(picture()!)
      act(() => {
        vi.advanceTimersByTime(wait)
      })
      expect(picture()).toHaveAttribute('src', `${image(1)}?retry=${retry}`)
    }
    fireEvent.error(picture()!)
    expect(picture()).toBeNull()
    expect(open).toHaveAccessibleDescription('Picture couldn’t be loaded')
  } finally {
    vi.useRealTimers()
  }
})

async function openDialog() {
  show(wornSuffixFigures())
  await userEvent.click(screen.getByRole('button', { name: /^Open picture 1 of 4/ }))
  return screen.getByRole('dialog', { name: 'The worn suffix, boxed' })
}

test('the larger view names the picture and the question, why it is shown and its marks', async () => {
  const dialog = await openDialog()

  expect(dialog).toHaveTextContent('Picture 1 of 4 · Which ATmega328P variant is this?')
  const about = within(dialog).getByRole('complementary', { name: 'About this picture' })
  expect(about).toHaveTextContent('Why the agent shows this')
  expect(about).toHaveTextContent('the box covers the B that tells the variants apart')
  const marks = within(about).getByRole('list', { name: 'Marks' })
  expect(
    within(marks)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['Box: the suffix in doubt', 'Label: “Worn: B or nothing?”'])
  expect(about).toHaveTextContent('Region 1840, 1210, 300 × 160 · ×3.4 · turned 90°')
  expect(about).toHaveTextContent('Lot 7')
  const photo = batchHref(F.batch, { tab: 'capture', photoId: F.evidence(20) })
  expect(within(about).getByRole('link', { name: 'IMG_3020' })).toHaveAttribute('href', photo)
  expect(within(dialog).getByRole('link', { name: 'Open in Capture' })).toHaveAttribute(
    'href',
    photo,
  )
  expect(within(dialog).getByRole('link', { name: 'Add a photo' })).toHaveAttribute(
    'href',
    captureHref,
  )
})

test('zooms in and out from Fit, and Fit returns to the whole view', async () => {
  const dialog = await openDialog()
  const zoom = within(dialog).getByRole('group', { name: 'Zoom' })
  const level = within(zoom).getByText('100%')

  expect(within(zoom).getByRole('button', { name: 'Zoom out' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.click(within(zoom).getByRole('button', { name: 'Zoom in' }))
  expect(level).toHaveTextContent('150%')
  await userEvent.click(within(zoom).getByRole('button', { name: 'Zoom in' }))
  expect(level).toHaveTextContent('200%')
  await userEvent.click(within(zoom).getByRole('button', { name: 'Zoom out' }))
  expect(level).toHaveTextContent('150%')
  await userEvent.click(within(zoom).getByRole('button', { name: 'Fit to the window' }))
  expect(level).toHaveTextContent('100%')
})

test('Whole photo shows the page preview with the region outlined', async () => {
  const snapshot = {
    batch_id: F.batch,
    revision: '1',
    attachments: [],
    groups: [],
    derivations: [],
    evidence: [
      {
        id: F.evidence(20),
        label: 'IMG_3020',
        group_id: null,
        linked_subject_ids: [],
        versions: [
          {
            id: F.version(20),
            evidence_id: F.evidence(20),
            kind: 'original',
            digest: 'a'.repeat(64),
            byte_size: '10',
            media_type: 'image/jpeg',
            state: 'ready',
            decoder_build: 'fixture',
            recipe: null,
            pages: [{ page: 1, width: 4000, height: 3000, preview_id: 'page-preview' }],
          },
        ],
      },
    ],
  } satisfies MediaSnapshotDto
  const media: MediaClient = {
    snapshot: vi.fn(async () => snapshot),
    removalImpact: vi.fn(),
    edit: vi.fn(),
    upload: vi.fn(),
  }
  show(wornSuffixFigures(), { media })
  await userEvent.click(screen.getByRole('button', { name: /^Open picture 1 of 4/ }))
  const dialog = screen.getByRole('dialog', { name: 'The worn suffix, boxed' })

  const whole = within(dialog).getByRole('button', { name: 'Show the whole original photo' })
  expect(whole).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(whole)
  expect(whole).toHaveAttribute('aria-pressed', 'true')
  const stage = within(dialog).getByRole('img', {
    name: 'IMG_3020 with the picture’s region outlined',
  })
  expect(stage.querySelector('[data-region-outline]')).not.toBeNull()
  await act(async () => {
    await Promise.resolve()
  })
  expect(await within(dialog).findByTestId('whole-page')).toHaveAttribute(
    'src',
    expect.stringContaining('/media/previews/page-preview'),
  )
  await userEvent.click(whole)
  expect(within(dialog).queryByTestId('whole-page')).not.toBeInTheDocument()
})

test('Whole photo outlines the region on a page-shaped box when the page preview isn’t readable', async () => {
  const dialog = await openDialog()

  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Show the whole original photo' }),
  )
  const stage = within(dialog).getByRole('img', {
    name: 'IMG_3020 with the picture’s region outlined',
  })
  expect(stage.querySelector('[data-region-outline]')).not.toBeNull()
  expect(dialog).toHaveTextContent('The page preview isn’t available here')
})

test('Whole photo outlines the window the picture samples, shrunk near the page edge', async () => {
  // 12° of straightening at the page's right edge: the corner guard shrinks the window.
  show([
    figure(1, {
      caption: 'At the edge',
      view: {
        region: { x: 3500, y: 1000, width: 500, height: 400 },
        quarter_turns: 0,
        straighten_millidegrees: 12000,
      },
    }),
  ])
  await userEvent.click(screen.getByRole('button', { name: /^Open picture 1 of 1/ }))
  const dialog = screen.getByRole('dialog', { name: 'At the edge' })
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Show the whole original photo' }),
  )

  const outline = dialog.querySelector('[data-region-outline]')!
  const width = Number(outline.getAttribute('width'))
  const height = Number(outline.getAttribute('height'))
  const x = Number(outline.getAttribute('x'))
  expect(width).toBeLessThan(500)
  expect(height / width).toBeCloseTo(400 / 500)
  // Centred on the region's centre, so the outline's right side stays on the page.
  expect(x + width / 2).toBeCloseTo(3750)
  expect(x + width).toBeLessThan(4000)
})

test('a zoomed picture takes focus and keeps the arrow keys for moving around it', async () => {
  const dialog = await openDialog()
  const stage = within(dialog).getByTestId('figure-stage')
  expect(stage).toHaveAttribute('tabindex', '-1')

  await userEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }))
  expect(stage).toHaveAttribute('tabindex', '0')
  expect(within(dialog).getByRole('region', { name: /^Picture at 150%/ })).toBe(stage)
  stage.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(dialog).toHaveTextContent('Picture 1 of 4')
  expect(within(dialog).getByRole('group', { name: 'Zoom' })).toHaveTextContent('150%')

  // Elsewhere in the dialog the arrows still move between pictures.
  within(dialog).getByRole('button', { name: 'Next picture' }).focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(dialog).toHaveTextContent('Picture 2 of 4')
})

test('previous and next buttons, thumbnails and arrow keys move between pictures', async () => {
  const dialog = await openDialog()

  expect(within(dialog).getByRole('button', { name: 'Previous picture' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Next picture' }))
  expect(dialog).toHaveTextContent('Picture 2 of 4')
  expect(within(dialog).getByRole('heading', { name: 'The slip, line 3' })).toBeVisible()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Previous picture' }))
  expect(dialog).toHaveTextContent('Picture 1 of 4')

  await userEvent.keyboard('{ArrowRight}{ArrowRight}')
  expect(dialog).toHaveTextContent('Picture 3 of 4')
  await userEvent.keyboard('{ArrowLeft}')
  expect(dialog).toHaveTextContent('Picture 2 of 4')

  const strip = within(dialog).getByRole('group', { name: 'Pictures for this question' })
  await userEvent.click(within(strip).getAllByRole('button')[3])
  expect(dialog).toHaveTextContent('Picture 4 of 4')
  expect(within(dialog).getByRole('button', { name: 'Next picture' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('hiding the marks keeps them listed, and the next picture shows without its marks', async () => {
  const dialog = await openDialog()

  const stage = () => within(dialog).getByTestId('figure-stage')

  const toggle = within(dialog).getByRole('switch', { name: 'Show the agent’s marks' })
  expect(toggle).toBeChecked()
  expect(marksIn(stage())).not.toBeNull()

  const strip = within(dialog).getByRole('group', { name: 'Pictures for this question' })
  expect(marksIn(strip)).not.toBeNull()
  await userEvent.click(toggle)
  expect(marksIn(stage())).toBeNull()
  expect(marksIn(strip)).toBeNull()
  const marks = within(dialog).getByRole('list', { name: 'Marks' })
  expect(marks).toHaveTextContent('Box: the suffix in doubt')

  await userEvent.keyboard('{ArrowRight}')
  expect(dialog).toHaveTextContent('Picture 2 of 4')
  expect(within(dialog).getByRole('switch', { name: 'Show the agent’s marks' })).not.toBeChecked()
  expect(marksIn(stage())).toBeNull()
  expect(within(dialog).getByRole('list', { name: 'Marks' })).toHaveTextContent('Highlight: line 3')
})

test('the larger view of a removed photo says so and offers no Capture link to it', async () => {
  show([figure(2, { caption: 'Gone', state: 'removed' })])
  await userEvent.click(screen.getByRole('button', { name: 'Open picture 1 of 1: Gone' }))
  const dialog = screen.getByRole('dialog', { name: 'Gone' })

  expect(within(dialog).getByTestId('figure-stage')).toHaveTextContent('Photo removed')
  expect(within(dialog).queryByRole('link', { name: 'Open in Capture' })).not.toBeInTheDocument()
  expect(within(dialog).getByRole('link', { name: 'Add a photo' })).toBeVisible()
  expect(within(dialog).queryByRole('button', { name: 'Next picture' })).not.toBeInTheDocument()
})

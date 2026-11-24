import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertMediaDecoderInputHeader,
  assertMediaGridOutputHeader,
  assertMediaLitViewRecipe,
  assertMediaLogoMatchOutputHeader,
  assertMediaPreviewOutputHeader,
  MEDIA_TOOLCHAIN,
  viewLayout,
  type MediaLitViewRecipeDto,
} from '../src/media.ts'

const digest = 'a'.repeat(64)

const recipe: MediaLitViewRecipeDto = {
  version: 'bench-intake-view/2',
  source_version_id: '10000000-0000-4000-8000-000000000001',
  source_digest: digest,
  page: 1,
  page_width: 4000,
  page_height: 3000,
  view: {
    region: { x: 100, y: 200, width: 3000, height: 1000 },
    quarter_turns: 1,
    straighten_millidegrees: -3500,
  },
  light: {
    white_balance: true,
    contrast_clip_permille: 5,
    gamma_thousandths: 1300,
    sharpen: true,
  },
}

const image = { width: 10, height: 10, byte_size: 100, digest }

test('recipe /2 carries bounded light adjustments and no marks', () => {
  assertMediaLitViewRecipe(recipe)
  assertMediaLitViewRecipe({
    ...recipe,
    light: {
      white_balance: false,
      contrast_clip_permille: null,
      gamma_thousandths: null,
      sharpen: false,
    },
  })
  const refused = [
    { ...recipe, marks: [] },
    { ...recipe, version: 'bench-intake-view/1' },
    { ...recipe, light: { ...recipe.light, contrast_clip_permille: 51 } },
    { ...recipe, light: { ...recipe.light, gamma_thousandths: 499 } },
    { ...recipe, light: { ...recipe.light, gamma_thousandths: 2001 } },
    { ...recipe, light: { ...recipe.light, white_balance_gains: [1, 1, 1] } },
    { ...recipe, view: { ...recipe.view, straighten_millidegrees: 15001 } },
  ]
  for (const value of refused) {
    assert.throws(() => assertMediaLitViewRecipe(value), /invalid_view_recipe/)
  }
})

test('a derived crop lays out at full resolution, a question view at most 2048 px', () => {
  const full = viewLayout(recipe, 'full')
  assert.equal(full.scale, 1)
  assert.deepEqual([full.width, full.height], [1000, 3000])
  const view = viewLayout(recipe)
  assert.equal(Math.max(view.width, view.height), 2048)
})

test('decoder input headers accept the lit recipe and the image tool operations', () => {
  assertMediaDecoderInputHeader({ version: 'media-decode/1', digest, recipe })
  const pages = [{ digest, width: 4000, height: 3000, byte_size: 1000 }]
  assertMediaDecoderInputHeader({
    version: 'media-preview/1',
    pages,
    crops: [{ label: 'part', page: 0, recipe }],
  })
  assertMediaDecoderInputHeader({
    version: 'media-grid/1',
    digest,
    width: 4000,
    height: 3000,
    region: { x: 0, y: 0, width: 400, height: 300 },
    preview_width: 1000,
    step: null,
    object: { x: 10, y: 10, width: 100, height: 100 },
    boxes: [{ name: 'box1', box: { x: 0, y: 0, width: 120, height: 120 } }],
  })
  assertMediaDecoderInputHeader({
    version: 'media-logo-match/1',
    digest,
    width: 4000,
    height: 3000,
    view: recipe.view,
    top: 15,
  })
})

test('decoder input headers refuse marks, too many crops and out-of-range requests', () => {
  const pages = [{ digest, width: 4000, height: 3000, byte_size: 1000 }]
  const crop = { label: 'part', page: 0, recipe }
  const refused = [
    { version: 'media-preview/1', pages, crops: [{ ...crop, recipe: { ...recipe, marks: [] } }] },
    { version: 'media-preview/1', pages, crops: Array.from({ length: 9 }, () => crop) },
    { version: 'media-preview/1', pages, crops: [{ ...crop, page: 4 }] },
    { version: 'media-preview/1', pages: [], crops: [crop] },
    {
      version: 'media-grid/1',
      digest,
      width: 10,
      height: 10,
      region: null,
      preview_width: 2001,
      step: null,
      object: null,
      boxes: [],
    },
    {
      version: 'media-logo-match/1',
      digest,
      width: 10,
      height: 10,
      view: recipe.view,
      top: 31,
    },
  ]
  for (const value of refused) {
    assert.throws(() => assertMediaDecoderInputHeader(value), /invalid_decoder_input/)
  }
})

test('decoder output headers for the image tool operations', () => {
  assertMediaPreviewOutputHeader({
    state: 'ready',
    toolchain: MEDIA_TOOLCHAIN,
    montage: image,
    crops: [
      {
        state: 'rendered',
        label: 'part',
        width: 300,
        height: 400,
        flags: ['corner_guard', 'white_balance_held_back'],
        white_balance_gains: { red: 0.93, green: 0.98, blue: 1.1 },
      },
      { state: 'refused', label: 'stock', reason: 'white_balance_hue_guard' },
    ],
  })
  assertMediaPreviewOutputHeader({ state: 'limit_exceeded', toolchain: MEDIA_TOOLCHAIN })
  assert.throws(() =>
    assertMediaPreviewOutputHeader({
      state: 'ready',
      toolchain: MEDIA_TOOLCHAIN,
      montage: image,
      crops: [
        {
          state: 'rendered',
          label: 'part',
          width: 1,
          height: 1,
          flags: ['marked'],
          white_balance_gains: null,
        },
      ],
    }),
  )
  assertMediaGridOutputHeader({
    state: 'ready',
    toolchain: MEDIA_TOOLCHAIN,
    image,
    region: { x: 0, y: 0, width: 480, height: 360 },
    scale: 2.083,
    step: 50,
    x_labels: [50, 100],
    y_labels: [50],
    boxes: [
      {
        name: 'box1',
        box: { x: 0, y: 0, width: 10, height: 10 },
        aspect: 1,
        margins: { left: -1, right: 2, top: 3, bottom: 4 },
        clips: true,
        off_centre: [],
      },
    ],
  })
  assert.throws(() => assertMediaGridOutputHeader({ state: 'ready', toolchain: MEDIA_TOOLCHAIN }))
  assertMediaLogoMatchOutputHeader({
    state: 'ready',
    toolchain: MEDIA_TOOLCHAIN,
    sheet: image,
    candidates: [
      {
        id: 'motorola1',
        manufacturer: 'Motorola',
        family: 'circ',
        page: 'p05-circ-1.png',
        score: 0.91,
      },
    ],
  })
  assertMediaLogoMatchOutputHeader({
    state: 'ready',
    toolchain: MEDIA_TOOLCHAIN,
    sheet: image,
    candidates: [],
  })
  assert.throws(() =>
    assertMediaLogoMatchOutputHeader({
      state: 'ready',
      toolchain: MEDIA_TOOLCHAIN,
      sheet: image,
      candidates: [{ id: 'x', manufacturer: 'X', family: 'mono', page: 'p', score: 2 }],
    }),
  )
})

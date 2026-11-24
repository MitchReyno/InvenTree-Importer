import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertMediaRecipe,
  requireMediaRecipeBounds,
  rotatedMediaRegion,
  viewLayout,
  type RotatedMediaRecipeDto,
} from '../src/media.ts'

const recipe: RotatedMediaRecipeDto = {
  version: 'documentary-rotated-region/1',
  source_version_id: '10000000-0000-4000-8000-000000000001',
  source_digest: 'a'.repeat(64),
  page: 1,
  source_width: 64,
  source_height: 48,
  center_x_micro: '32000000',
  center_y_micro: '24000000',
  width_micro: '20000000',
  height_micro: '12000000',
  rotation_millidegrees: 37000,
  output_width: 20,
  output_height: 12,
  aspect_ratio: { width: 5, height: 3 },
}

test('rotated selection checks all oblique corners, exact dimensions, ratio and bounded scalar syntax', () => {
  assertMediaRecipe(recipe)
  const region = rotatedMediaRegion(recipe)
  assert.equal(region.corners.length, 4)
  assert.throws(
    () => rotatedMediaRegion({ ...recipe, center_x_micro: '1000000' }),
    /outside_source/,
  )
  assert.throws(() => rotatedMediaRegion({ ...recipe, output_width: 21 }), /dimensions/)
  assert.throws(
    () => rotatedMediaRegion({ ...recipe, aspect_ratio: { width: 1, height: 1 } }),
    /aspect_changed/,
  )
  assert.throws(() => assertMediaRecipe({ ...recipe, center_x_micro: '32000000\n' }))
  assert.throws(() => assertMediaRecipe({ ...recipe, rotation_millidegrees: 360000 }))
  assert.throws(() => assertMediaRecipe({ ...recipe, quarter_turns: 1 }))
})

test('legacy recipe remains accepted without new fields and retains crop-first bounds', () => {
  const legacy = {
    version: 'documentary-crop/1' as const,
    source_version_id: recipe.source_version_id,
    source_digest: recipe.source_digest,
    page: 1,
    source_width: 64,
    source_height: 48,
    x: 3,
    y: 4,
    width: 20,
    height: 12,
    quarter_turns: 1,
  }
  const before = JSON.stringify(legacy)
  assertMediaRecipe(legacy)
  requireMediaRecipeBounds(legacy)
  assert.equal(JSON.stringify(legacy), before)
  assert.throws(() => requireMediaRecipeBounds({ ...legacy, x: 50 }), /outside_source/)
})

const viewRecipe = (view: object) => ({
  version: 'bench-intake-view/1' as const,
  source_version_id: '10000000-0000-4000-8000-000000000001',
  source_digest: 'a'.repeat(64),
  page: 1,
  page_width: 4000,
  page_height: 3000,
  view: {
    region: { x: 1000, y: 1000, width: 900, height: 500 },
    quarter_turns: 0,
    straighten_millidegrees: 0,
    ...view,
  },
})

test('a view keeps its region, swaps sides on odd quarter turns and enlarges small regions up to 4×', () => {
  const plain = viewLayout(viewRecipe({}))
  assert.equal(plain.guard, 1)
  assert.equal(plain.centerX, 1450)
  assert.equal(plain.centerY, 1250)
  assert.deepEqual([plain.width, plain.height], [1024, 569])
  assert.deepEqual([plain.thumbWidth, plain.thumbHeight], [480, 267])
  const turned = viewLayout(viewRecipe({ quarter_turns: 1 }))
  assert.deepEqual([turned.width, turned.height], [569, 1024])
  const tiny = viewLayout(viewRecipe({ region: { x: 0, y: 0, width: 100, height: 50 } }))
  assert.equal(tiny.scale, 4)
  assert.deepEqual([tiny.width, tiny.height], [400, 200])
  const large = viewLayout(viewRecipe({ region: { x: 0, y: 0, width: 4000, height: 3000 } }))
  assert.deepEqual([large.width, large.height], [2048, 1536])
  assert.throws(
    () => viewLayout(viewRecipe({ region: { x: 3500, y: 0, width: 600, height: 10 } })),
    /view_region_outside_page/,
  )
})

test('straightening shrinks the window only as far as its corners need to stay on the page', () => {
  const inside = viewLayout(viewRecipe({ straighten_millidegrees: 15000 }))
  assert.equal(inside.guard, 1)
  const edge = viewLayout(
    viewRecipe({
      region: { x: 0, y: 0, width: 4000, height: 3000 },
      straighten_millidegrees: -15000,
    }),
  )
  assert.ok(edge.guard < 1)
  const radians = (15 * Math.PI) / 180
  const halfWidth =
    (edge.windowWidth * Math.cos(radians) + edge.windowHeight * Math.sin(radians)) / 2
  const halfHeight =
    (edge.windowWidth * Math.sin(radians) + edge.windowHeight * Math.cos(radians)) / 2
  assert.ok(Math.abs(Math.max(halfWidth / 2000, halfHeight / 1500) - 1) < 1e-9)
  assert.ok(halfWidth <= 2000 + 1e-9 && halfHeight <= 1500 + 1e-9)
})

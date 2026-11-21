import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertMediaRecipe,
  requireMediaRecipeBounds,
  rotatedMediaRegion,
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

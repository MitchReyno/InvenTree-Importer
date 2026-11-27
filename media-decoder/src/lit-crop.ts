import { viewLayout, type MediaLitViewRecipeDto } from '@invimport/contracts/media'
import { applyLight, type WhiteBalanceOutcome } from './light.ts'
import { viewPixels, type PagePng, type RawRgb } from './view-pixels.ts'

export type LitCrop =
  | {
      state: 'rendered'
      image: RawRgb
      /** The corner guard shrank the region so straightening shows no blank corners. */
      cornerGuard: boolean
      whiteBalance: WhiteBalanceOutcome | null
    }
  | { state: 'refused'; reason: 'white_balance_hue_guard' }

/**
 * Renders a recipe `/2` crop at the region's full resolution: BI-019's view geometry, then the
 * light step. A preview and the derived crop both come from here, so they are the same pixels.
 * The recipe must fit the page; `viewLayout` throws `view_region_outside_page` otherwise.
 */
export async function renderLitCrop(
  page: PagePng,
  recipe: MediaLitViewRecipeDto,
): Promise<LitCrop> {
  const layout = viewLayout(recipe, 'full')
  const pixels = await viewPixels(page, recipe.view.quarter_turns, layout)
  const lit = await applyLight(pixels, recipe.light)
  if (lit.state === 'refused') {
    return lit
  }
  return {
    state: 'rendered',
    image: lit.image,
    cornerGuard: layout.guard < 1,
    whiteBalance: lit.whiteBalance,
  }
}

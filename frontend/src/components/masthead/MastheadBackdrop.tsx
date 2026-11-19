import type { pageWidth } from '#/theme/generated/tokens'
import { useMastheadStyle } from '#/theme/masthead-style'
import { MastheadField } from './MastheadField'

type MastheadBackdropProps = {
  width: keyof typeof pageWidth
}

/**
 * The page-level current for the masthead styles that reach beyond the bar. Keyed by style, so
 * every change releases the previous scene before the next one starts.
 */
export function MastheadBackdrop({ width }: MastheadBackdropProps) {
  const { style } = useMastheadStyle()

  if (style === 'bar') {
    return null
  }

  return <MastheadField key={style} style={style} width={width} />
}

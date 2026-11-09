import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import styled from 'styled-components'
import { color, icon, radius, size } from '#/theme/generated/tokens'
import { media } from './media'
import { hoverTransition } from './motion'

type CommonProps = {
  /** The accessible name and desktop tooltip; the icon alone must be universal. */
  label: string
  /** An inline SVG from `icons.tsx`, drawn in `currentColor`. */
  icon: ReactNode
}

type AsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    href?: never
    ref?: Ref<HTMLButtonElement>
  }

type AsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
    href: string
    ref?: Ref<HTMLAnchorElement>
  }

export type IconButtonProps = AsButton | AsLink

/** A control that shows only an icon: a link when it navigates, a button when it acts. */
export function IconButton(props: IconButtonProps) {
  if (props.href !== undefined) {
    const { label, icon: glyph, ...anchor } = props

    return (
      <Control as="a" aria-label={label} title={label} {...anchor}>
        {glyph}
      </Control>
    )
  }

  const { label, icon: glyph, ...button } = props

  return (
    <Control type="button" aria-label={label} title={label} {...button}>
      {glyph}
    </Control>
  )
}

const Control = styled.button`
  display: inline-grid;
  place-items: center;
  min-width: ${size.control};
  min-height: ${size.control};
  padding: 0;
  border: 0;
  border-radius: ${radius.btn};
  background: transparent;
  color: ${color.fg};
  text-decoration: none;
  cursor: pointer;
  ${hoverTransition}
  &:hover:not([aria-disabled='true']):not(:disabled) {
    background: ${color.surface2};
  }
  &[aria-disabled='true'],
  &:disabled {
    cursor: not-allowed;
  }
  svg {
    display: block;
    width: ${icon.md};
    height: ${icon.md};
  }
  ${media.phone} {
    min-width: ${size.touch};
    min-height: ${size.touch};
  }
`

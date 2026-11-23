import {
  useId,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type Ref,
  type ReactNode,
} from 'react'
import styled, { css } from 'styled-components'
import { color, opacity, radius, size, space, type, typeVar } from '#/theme/generated/tokens'
import { media } from './media'
import { hoverTransition } from './motion'
import { Spinner } from './Loading'
import { linkTouchArea } from './primitives'
import { visuallyHidden } from './VisuallyHidden'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'warn' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

type CommonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Decorative glyph shown before the label. */
  icon?: ReactNode
  children: ReactNode
}

type AsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    as?: 'button'
    ref?: Ref<HTMLButtonElement>
    busy?: boolean
    /** Shown beside a disabled button and linked as its description. */
    disabledReason?: string
    /**
     * `quiet` keeps a passing reason, such as a read still landing, out of the layout: the button
     * stays focusable with `aria-disabled`, and the reason is its description and a tooltip.
     */
    reasonDisplay?: 'beside' | 'quiet'
  }

/** Links navigate, so they have no busy or disabled state; use a button for those. */
type AsLink = CommonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    as: 'a'
    href: string
    busy?: never
    disabledReason?: never
    reasonDisplay?: never
  }

export type ButtonProps = AsButton | AsLink

export function Button(props: ButtonProps) {
  return props.as === 'a' ? <LinkButton {...props} /> : <NativeButton {...props} />
}

function Content({
  icon,
  busy,
  children,
}: Pick<CommonProps, 'icon' | 'children'> & { busy?: boolean }) {
  const lead = busy ? <Spinner /> : icon

  return (
    <>
      {lead !== undefined && <Glyph aria-hidden="true">{lead}</Glyph>}
      {children}
    </>
  )
}

function LinkButton({
  as,
  variant = 'secondary',
  size = 'md',
  icon,
  busy,
  disabledReason,
  reasonDisplay,
  children,
  ...anchor
}: AsLink) {
  return (
    <Control as={as} $variant={variant} $size={size} {...anchor}>
      <Content icon={icon} busy={busy}>
        {children}
      </Content>
    </Control>
  )
}

function NativeButton({
  as,
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  disabledReason,
  reasonDisplay = 'beside',
  children,
  onClick,
  ...button
}: AsButton) {
  const reasonId = useId()
  const quiet = reasonDisplay === 'quiet'
  const quietlyUnavailable = quiet && disabledReason !== undefined
  const disabled = button.disabled || (!quiet && disabledReason !== undefined)

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy || quietlyUnavailable) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  const control = (
    <Control
      as={as}
      type="button"
      {...button}
      disabled={disabled}
      aria-disabled={quietlyUnavailable || button['aria-disabled']}
      aria-busy={busy || undefined}
      aria-describedby={disabledReason ? reasonId : button['aria-describedby']}
      onClick={handleClick}
      $variant={variant}
      $size={size}
    >
      <Content icon={icon} busy={busy}>
        {children}
      </Content>
    </Control>
  )

  // The wrapper stays while the reason comes and goes, so the button keeps its element and focus.
  if (quiet) {
    return (
      <QuietAnchor>
        {control}
        {disabledReason && (
          <QuietReason id={reasonId} role="tooltip">
            {disabledReason}
          </QuietReason>
        )}
      </QuietAnchor>
    )
  }

  return (
    <>
      {control}
      {disabledReason && <Reason id={reasonId}>{disabledReason}</Reason>}
    </>
  )
}

const variants = {
  primary: css`
    background: ${color.accent};
    border-color: ${color.accent};
    color: ${color.onAccent};
    &:hover:not(:disabled):not([aria-disabled='true']) {
      filter: brightness(1.07);
    }
    &:active:not(:disabled):not([aria-disabled='true']) {
      filter: brightness(0.95);
    }
  `,
  secondary: css`
    &:hover:not(:disabled):not([aria-disabled='true']) {
      background: ${color.surface2};
    }
  `,
  ghost: css`
    border-color: transparent;
    background: transparent;
    &:hover:not(:disabled):not([aria-disabled='true']) {
      background: ${color.surface2};
    }
  `,
  warn: css`
    border-color: ${color.warn};
    color: ${color.warn};
    &:hover:not(:disabled):not([aria-disabled='true']) {
      background: ${color.warnWeak};
    }
  `,
  link: css`
    border: 0;
    background: none;
    padding: 0;
    color: ${color.accent};
    text-decoration: underline;
    text-underline-offset: 2px;
  `,
}

const sizes = {
  sm: css`
    padding: ${space[2]} calc(${space[5]} - 1px);
    font-size: ${typeVar.small.size};
  `,
  md: css`
    padding: calc(${space[4]} - 1px) ${space[6]};
  `,
  lg: css`
    padding: ${space[6]} ${space[8]};
    ${type.buttonLg}
  `,
}

const Control = styled.button<{ $variant: ButtonVariant; $size: ButtonSize }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${space[3]};
  min-height: ${size.control};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  background: ${color.surface};
  color: ${color.fg};
  font-weight: ${typeVar.buttonLg.weight};
  line-height: 1.2;
  text-decoration: none;
  cursor: pointer;
  touch-action: manipulation;
  ${hoverTransition}
  ${({ $size }) => sizes[$size]}
  ${({ $variant }) => variants[$variant]}
  ${({ $variant }) => ($variant === 'link' ? 'min-height: 0;' : '')}
  &:disabled,
  &[aria-disabled='true'] {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  &[aria-busy='true'] {
    cursor: progress;
  }
  ${media.compact} {
    min-height: ${({ $variant }) => ($variant === 'link' ? '0' : size.touch)};
    min-width: ${({ $variant }) => ($variant === 'link' ? '0' : size.touch)};
  }
  ${({ $variant }) => $variant === 'link' && linkTouchArea}
`

const Glyph = styled.span`
  display: inline-flex;
  line-height: 1;
`

const Reason = styled.span`
  margin-left: ${space[4]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const QuietAnchor = styled.span`
  position: relative;
  display: inline-flex;
`

/** Read as the button's description; drawn only on hover or keyboard focus, over the page. */
const QuietReason = styled.span`
  ${visuallyHidden}
  ${QuietAnchor}:hover > &,
  ${QuietAnchor}:has(:focus-visible) > & {
    clip: auto;
    width: max-content;
    height: auto;
    margin: 0;
    overflow: visible;
    bottom: calc(100% + ${space[2]});
    left: 0;
    z-index: 3;
    padding: ${space[2]} ${space[4]};
    border-radius: ${radius.btn};
    background: ${color.fg};
    color: ${color.bg};
    font-size: ${typeVar.small.size};
    white-space: nowrap;
    pointer-events: none;
  }
`

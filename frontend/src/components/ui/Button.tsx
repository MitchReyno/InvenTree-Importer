import {
  useId,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type Ref,
  type ReactNode,
} from 'react'
import styled, { css } from 'styled-components'
import { color, opacity, radius, size, space, type, typeVar } from '../../theme/generated/tokens'
import { media } from './media'
import { hoverTransition } from './motion'
import { Spinner } from './Loading'

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
  }

/** Links navigate, so they have no busy or disabled state; use a button for those. */
type AsLink = CommonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    as: 'a'
    href: string
    busy?: never
    disabledReason?: never
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
  children,
  onClick,
  ...button
}: AsButton) {
  const reasonId = useId()
  const disabled = button.disabled || disabledReason !== undefined

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <>
      <Control
        as={as}
        type="button"
        {...button}
        disabled={disabled}
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
      {disabledReason && <Reason id={reasonId}>{disabledReason}</Reason>}
    </>
  )
}

const variants = {
  primary: css`
    background: ${color.accent};
    border-color: ${color.accent};
    color: ${color.onAccent};
    &:hover:not(:disabled) {
      filter: brightness(1.07);
    }
    &:active:not(:disabled) {
      filter: brightness(0.95);
    }
  `,
  secondary: css`
    &:hover:not(:disabled) {
      background: ${color.surface2};
    }
  `,
  ghost: css`
    border-color: transparent;
    background: transparent;
    &:hover:not(:disabled) {
      background: ${color.surface2};
    }
  `,
  warn: css`
    border-color: ${color.warn};
    color: ${color.warn};
    &:hover:not(:disabled) {
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
  &:disabled {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  &[aria-busy='true'] {
    cursor: progress;
  }
  ${media.compact} {
    min-height: ${({ $variant }) => ($variant === 'link' ? '0' : size.touch)};
  }
  /* A link keeps its line height; an invisible box gives it the touch-size hit area. */
  ${({ $variant }) =>
    $variant === 'link' &&
    css`
      ${media.compact} {
        position: relative;
        &::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          width: max(100%, ${size.touch});
          height: ${size.touch};
          transform: translate(-50%, -50%);
        }
      }
    `}
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

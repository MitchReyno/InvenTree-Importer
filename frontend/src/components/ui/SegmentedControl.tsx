import styled from 'styled-components'
import { color, opacity, radius, ring, size, space, typeVar } from '#/theme/generated/tokens'
import { media } from './media'
import { useRovingFocus } from './useRovingFocus'
import { hoverTransition } from './motion'

export type SegmentOption = { id: string; label: string }

type SegmentedControlProps = {
  label: string
  options: SegmentOption[]
  value: string
  onChange: (id: string) => void
  /**
   * Shows every segment unavailable and ignores choices, while focus can still reach it; for a
   * moment such as a pending save, not a deferred feature (that is `DisabledFeature`).
   */
  disabled?: boolean
}

/** Switches between views of the same list. */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps) {
  const optionProps = useRovingFocus(
    options.map((option) => option.id),
    value,
  )

  return (
    <Group role="group" aria-label={label}>
      {options.map((option) => (
        <Segment
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          aria-disabled={disabled ? 'true' : undefined}
          onClick={() => {
            if (!disabled) {
              onChange(option.id)
            }
          }}
          {...optionProps(option.id)}
        >
          {option.label}
        </Segment>
      ))}
    </Group>
  )
}

const Group = styled.div`
  display: inline-flex;
  overflow: hidden;
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
`

const Segment = styled.button`
  padding: ${space[3]} 11px;
  border: 0;
  background: ${color.surface};
  font-weight: ${typeVar.buttonLg.weight};
  cursor: pointer;
  ${hoverTransition}
  /* The pressed segment keeps its fg fill on hover, as a pressed filter chip does. */
  &:hover:not([aria-disabled='true']):not([aria-pressed='true']) {
    background: ${color.surface2};
  }
  &[aria-disabled='true'] {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  &[aria-pressed='true'] {
    background: ${color.fg};
    color: ${color.bg};
  }
  /* An inset accent ring with a bg band inside it, so the ring never sits on the fg fill. */
  &:focus-visible {
    outline: none;
    box-shadow:
      inset 0 0 0 ${ring.width} ${color.accent},
      inset 0 0 0 calc(${ring.width} + ${ring.offset}) ${color.bg};
  }
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
  }
`

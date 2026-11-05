import styled from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { media } from './media'
import { useRovingFocus } from './useRovingFocus'

export type SegmentOption = { id: string; label: string }

type SegmentedControlProps = {
  label: string
  options: SegmentOption[]
  value: string
  onChange: (id: string) => void
}

/** Switches between views of the same list. */
export function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
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
          onClick={() => onChange(option.id)}
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
  padding: ${space['1-5']} 11px;
  border: 0;
  background: ${color.surface};
  font-weight: 500;
  cursor: pointer;
  transition: background-color 80ms linear;
  &:hover {
    background: ${color.surface2};
  }
  &[aria-pressed='true'] {
    background: ${color.fg};
    color: ${color.bg};
  }
  /* An inset accent ring with a bg band inside it, so the ring never sits on the fg fill. */
  &:focus-visible {
    outline: none;
    box-shadow:
      inset 0 0 0 2px ${color.accent},
      inset 0 0 0 4px ${color.bg};
  }
  ${media.compact} {
    min-width: 44px;
    min-height: 44px;
  }
`

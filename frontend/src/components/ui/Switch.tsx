import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, duration, easing, opacity, radius, space } from '#/theme/generated/tokens'

type SwitchProps = {
  /** Says what "on" does. */
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  'aria-disabled'?: boolean | 'true'
  'aria-describedby'?: string
}

/** An on/off setting that applies at once; use a checkbox where a Save or approval follows. */
export function Switch({ label, checked, onChange, disabled, ...aria }: SwitchProps) {
  return (
    <Label>
      <Track
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        {...aria}
      />
      {label}
    </Label>
  )
}

const Label = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${space[5]};
  cursor: pointer;
`

const Track = styled.input`
  position: relative;
  flex: none;
  /* literal-allowed: the track's own geometry, sized around the 16px knob */
  width: 36px;
  /* literal-allowed: the track's own geometry, sized around the 16px knob */
  height: 20px;
  margin: 0;
  border-radius: ${radius.pill};
  background: ${color.lineStrong};
  appearance: none;
  cursor: pointer;
  &::after {
    content: '';
    position: absolute;
    top: ${space[1]};
    left: ${space[1]};
    width: 16px;
    height: 16px;
    border-radius: ${radius.round};
    background: ${color.surface};
    transition: left ${duration.enter} ${easing.enter};
  }
  &:checked {
    background: ${color.accent};
  }
  &:checked::after {
    left: calc(100% - 16px - ${space[1]});
  }
  &:disabled,
  &[aria-disabled='true'] {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
`

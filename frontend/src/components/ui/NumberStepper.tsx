import styled from 'styled-components'
import { color, opacity, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { Small } from './primitives'

type NumberStepperProps = {
  /** Names the group, such as "Sessions at once". */
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  'aria-disabled'?: boolean | 'true'
  'aria-describedby'?: string
}

/** A small whole number with − and ＋; each button disables at its limit. */
export function NumberStepper({
  label,
  value,
  min,
  max,
  onChange,
  'aria-disabled': deferred,
  'aria-describedby': describedBy,
}: NumberStepperProps) {
  const atMin = value <= min
  const atMax = value >= max

  // A limit uses aria-disabled, not disabled, so the focused button keeps focus when it is reached.
  function step(blocked: boolean, next: number) {
    if (!blocked && !deferred) {
      onChange(next)
    }
  }

  return (
    <Group role="group" aria-label={label}>
      <Stepper>
        <button
          type="button"
          aria-label="One fewer"
          aria-disabled={atMin || deferred ? 'true' : undefined}
          aria-describedby={describedBy}
          onClick={() => step(atMin, value - 1)}
        >
          −
        </button>
        <output aria-live="polite" role="status">
          {value}
        </output>
        <button
          type="button"
          aria-label="One more"
          aria-disabled={atMax || deferred ? 'true' : undefined}
          aria-describedby={describedBy}
          onClick={() => step(atMax, value + 1)}
        >
          ＋
        </button>
      </Stepper>
      <Small>
        {min} to {max}
      </Small>
    </Group>
  )
}

const Group = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${space[6]};
`

const Stepper = styled.div`
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  button {
    width: 40px;
    height: 36px;
    border: 0;
    background: ${color.surface};
    color: ${color.fg};
    font-size: ${typeVar.h2.size};
    cursor: pointer;
  }
  button:hover:not([aria-disabled='true']) {
    background: ${color.surface2};
  }
  button[aria-disabled='true'] {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  output {
    min-width: ${size.touch};
    border-inline: 1px solid ${color.line};
    line-height: 36px;
    text-align: center;
    font-weight: ${typeVar.h2.weight};
    font-variant-numeric: tabular-nums;
  }
`

import { useId, useState } from 'react'
import styled from 'styled-components'
import { color, radius, shadow, space } from '../../theme/generated/tokens'

type Props = { label: string; explanation: string }

/**
 * A disabled checkbox cannot take focus, so a focusable group carries the explanation as its
 * description and shows it as a tooltip on focus or hover.
 */
export function DisabledFeature({ label, explanation }: Props) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <Wrapper
      role="group"
      tabIndex={0}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-tip`}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setShown(false)
        }
      }}
    >
      <Soon>Coming later</Soon>
      <label>
        <input type="checkbox" disabled tabIndex={-1} />
        <span id={`${id}-label`}>{label}</span>
      </label>
      <Tip id={`${id}-tip`} role="tooltip" hidden={!shown}>
        {explanation}
      </Tip>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  position: relative;
  display: inline-flex;
  flex-direction: column;
  gap: ${space[2]};
  min-height: 44px;
  padding: ${space[5]} ${space[6]};
  border: 1px dashed ${color.lineStrong};
  border-radius: ${radius.card};
  color: ${color.muted};
  label {
    display: inline-flex;
    gap: ${space[4]};
    align-items: center;
    cursor: not-allowed;
  }
`

const Soon = styled.span`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${color.info};
`

const Tip = styled.span`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  width: max-content;
  max-width: min(280px, calc(100vw - 32px));
  padding: ${space[3]} ${space[4]};
  border-radius: ${radius.sm};
  background: ${color.fg};
  color: ${color.bg};
  box-shadow: ${shadow};
  font-size: 12.5px;
  line-height: 1.4;
  &[hidden] {
    display: none;
  }
`

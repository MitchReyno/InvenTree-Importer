import { useId, useState } from 'react'
import styled from 'styled-components'

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
  min-height: 44px;
  align-items: center;
  border-radius: 5px;
  color: #526179;
  label {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: 2px solid #266ac5;
    outline-offset: 2px;
  }
`
const Tip = styled.span`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  width: max-content;
  max-width: min(280px, calc(100vw - 32px));
  padding: 8px 10px;
  border-radius: 5px;
  background: #233349;
  color: #fff;
  font-size: 13px;
  line-height: 1.4;
  &[hidden] {
    display: none;
  }
`

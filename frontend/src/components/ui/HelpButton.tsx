import { useState } from 'react'
import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { HelpIcon } from './icons'
import { hoverTransition } from './motion'
import { Popover } from './Popover'

type HelpButtonProps = {
  /** Says what it explains, such as "About groups". */
  label: string
  /** One or two sentences; also the hover tooltip. */
  explanation: string
}

/**
 * Holds the explanation a heading, legend or shortcut list would otherwise print in grey. Only for
 * "what is this?": never status, warnings or anything a person must read to act.
 */
export function HelpButton({ label, explanation }: HelpButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      label={label}
      open={open}
      onOpenChange={setOpen}
      align="start"
      trigger={
        <Disc type="button" aria-label={label} title={explanation}>
          <HelpIcon />
        </Disc>
      }
    >
      <Explanation>{explanation}</Explanation>
    </Popover>
  )
}

// A 22px disc whose hit area reaches the 44px touch target.
const Disc = styled.button`
  position: relative;
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: ${radius.round};
  background: ${color.accentWeak};
  color: ${color.accent};
  cursor: help;
  ${hoverTransition}
  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: ${size.touch};
    height: ${size.touch};
    transform: translate(-50%, -50%);
  }
  &:hover,
  &[aria-expanded='true'] {
    border-color: ${color.accent};
  }
  svg {
    display: block;
    width: 13px;
    height: 13px;
  }
`

const Explanation = styled.p`
  max-width: 300px;
  margin: 0;
  padding: ${space[3]} ${space[4]};
  font-size: ${typeVar.small.size};
`

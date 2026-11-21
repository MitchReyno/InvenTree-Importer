import { useState } from 'react'
import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { Popover, media, visuallyHidden } from '#/components/ui'
import { DevTools } from './DevTools'

const POPOVER_WIDTH = '340px'

/**
 * The Dev mode pill in the bar: a button opening developer tools. At phone width it shortens to
 * "Dev", still read in full.
 */
export function DevModeButton() {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      label="Developer tools"
      open={open}
      onOpenChange={setOpen}
      align="start"
      width={POPOVER_WIDTH}
      trigger={
        <Pill type="button" aria-label="Dev mode: open developer tools">
          Dev<CompactHidden> mode</CompactHidden>
        </Pill>
      }
    >
      <DevTools onNavigate={() => setOpen(false)} />
    </Popover>
  )
}

const Pill = styled.button`
  position: relative;
  padding: ${space[1]} ${space[4]};
  border: 1px solid ${color.devLine};
  border-radius: ${radius.pill};
  background: ${color.devBg};
  color: ${color.devFg};
  font: inherit;
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  /* The pill stays small; its hit area reaches the touch target. */
  &::after {
    content: '';
    position: absolute;
    inset: 50% auto auto 50%;
    width: max(100%, ${size.touch});
    height: max(100%, ${size.touch});
    transform: translate(-50%, -50%);
  }
`

const CompactHidden = styled.span`
  ${media.compact} {
    ${visuallyHidden}
  }
`

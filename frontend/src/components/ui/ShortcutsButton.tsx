import { useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, icon, radius, space, typeVar } from '#/theme/generated/tokens'
import { Button } from './Button'
import { HelpIcon } from './icons'
import { Popover } from './Popover'

type ShortcutsButtonProps = {
  /** Every shortcut on one line, shown as the hover tooltip. */
  summary: string
  /** The shortcut list, one item per shortcut. */
  children: ReactNode
}

/** A screen's keyboard shortcuts behind a ghost "Shortcuts" button that carries the help disc. */
export function ShortcutsButton({ summary, children }: ShortcutsButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      label="Keyboard shortcuts"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          size="sm"
          variant="ghost"
          aria-label="Keyboard shortcuts"
          title={summary}
          icon={
            <Disc>
              <HelpIcon />
            </Disc>
          }
        >
          Shortcuts
        </Button>
      }
    >
      <List>{children}</List>
    </Popover>
  )
}

// The HelpButton disc at 20px, before the word.
const Disc = styled.span`
  display: inline-grid;
  place-items: center;
  width: ${icon.md};
  height: ${icon.md};
  border-radius: ${radius.round};
  background: ${color.accentWeak};
  color: ${color.accent};
  svg {
    display: block;
    width: 13px;
    height: 13px;
  }
`

const List = styled.ul`
  display: grid;
  gap: ${space[3]};
  margin: 0;
  padding: ${space[3]} ${space[4]};
  list-style: none;
  font-size: ${typeVar.small.size};
  li {
    display: flex;
    align-items: center;
    gap: ${space[2]};
  }
`

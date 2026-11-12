import { useId, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import styled from 'styled-components'
import { color, opacity, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { IconButton } from './IconButton'
import { media } from './media'
import { Popover } from './Popover'

export type ActionsMenuItem = {
  label: string
  onSelect: () => void
  /** Why the action is unavailable; the item stays focusable and announces it. */
  disabledReason?: string
}

type ActionsMenuProps = {
  /** The trigger's accessible name, which also names the menu, such as "Actions for Front label". */
  label: string
  items: ActionsMenuItem[]
  /** The trigger, so a caller can return focus to it. */
  triggerRef?: Ref<HTMLButtonElement>
}

/**
 * A "⋯" button opening a menu of actions. Arrow keys, Home and End move between the items and
 * Escape closes it; choosing an item closes the menu and leaves focus on the trigger, so a dialog
 * the item opens returns focus there.
 */
export function ActionsMenu({ label, items, triggerRef }: ActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const itemElements = useRef<(HTMLButtonElement | null)[]>([])
  // Set while an item is chosen or Tab leaves, so closing doesn't move focus a second time.
  const chosen = useRef(false)
  // Which item takes focus when the menu opens: the last one when ArrowUp opened it.
  const openAtLast = useRef(false)
  const reasonId = useId()

  function setTrigger(element: HTMLButtonElement | null) {
    trigger.current = element
    if (typeof triggerRef === 'function') {
      triggerRef(element)
    } else if (triggerRef) {
      triggerRef.current = element
    }
  }

  function focusItem(index: number) {
    const count = items.length
    itemElements.current[(index + count) % count]?.focus()
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openAtLast.current = event.key === 'ArrowUp'
      setOpen(true)
    }
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      focusItem(index + 1)
    } else if (event.key === 'ArrowUp') {
      focusItem(index - 1)
    } else if (event.key === 'Home') {
      focusItem(0)
    } else if (event.key === 'End') {
      focusItem(items.length - 1)
    } else if (event.key === 'Tab') {
      // Focus goes back to the trigger first, so the browser's Tab carries on from there.
      chosen.current = true
      setOpen(false)
      trigger.current?.focus()
      return
    } else {
      return
    }
    event.preventDefault()
  }

  function choose(item: ActionsMenuItem) {
    if (item.disabledReason) {
      return
    }
    chosen.current = true
    setOpen(false)
    trigger.current?.focus()
    item.onSelect()
  }

  return (
    <Popover
      label={label}
      role="menu"
      align="end"
      open={open}
      onOpenChange={setOpen}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        focusItem(openAtLast.current ? items.length - 1 : 0)
        openAtLast.current = false
      }}
      onCloseAutoFocus={(event) => {
        if (chosen.current) {
          chosen.current = false
          event.preventDefault()
        }
      }}
      trigger={
        <IconButton
          ref={setTrigger}
          label={label}
          aria-haspopup="menu"
          icon={<Glyph aria-hidden="true">⋯</Glyph>}
          onKeyDown={handleTriggerKeyDown}
        />
      }
    >
      {items.map((item, index) => {
        const describedBy = item.disabledReason ? `${reasonId}-${index}` : undefined
        return (
          <Item
            key={item.label}
            ref={(element) => {
              itemElements.current[index] = element
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-label={item.label}
            aria-disabled={item.disabledReason ? 'true' : undefined}
            aria-describedby={describedBy}
            onKeyDown={(event) => handleItemKeyDown(event, index)}
            onClick={() => choose(item)}
          >
            <span>{item.label}</span>
            {item.disabledReason && <Reason id={describedBy}>{item.disabledReason}</Reason>}
          </Item>
        )
      })}
    </Popover>
  )
}

const Glyph = styled.span`
  font-size: ${typeVar.body.size};
  line-height: 1;
`

const Item = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[1]};
  width: 100%;
  min-width: 180px; /* literal-allowed: menu width so short labels don't collapse it */
  padding: ${space[3]} ${space[4]};
  border: 0;
  border-radius: ${radius.sm};
  background: none;
  color: ${color.fg};
  font: inherit;
  font-size: ${typeVar.small.size};
  text-align: left;
  cursor: pointer;
  &:hover:not([aria-disabled='true']),
  &:focus-visible {
    background: ${color.surface2};
  }
  &[aria-disabled='true'] {
    cursor: not-allowed;
    span:first-child {
      opacity: ${opacity.disabled};
    }
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const Reason = styled.span`
  max-width: 280px; /* literal-allowed: keeps a reason to a readable line length */
  color: ${color.muted};
  white-space: normal;
`

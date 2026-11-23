import { useState } from 'react'
import type { BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, size, space, type } from '#/theme/generated/tokens'
import { media, hoverTransition, Button, Count, Pill, Popover } from '#/components/ui'
import { NeedsYouList } from './NeedsYouList'

type NeedsYouPanelProps = {
  attention: BatchAttentionDto
  /** The sticky phone row's "?5": the count alone, and nothing when no item waits. */
  compact?: boolean
}

/** Every open item in the batch, grouped by the tab that owns it. */
export function NeedsYouPanel({ attention, compact = false }: NeedsYouPanelProps) {
  const [open, setOpen] = useState(false)
  const total = attention.items.length
  const count = attention.items_truncated ? `${total}+` : String(total)
  const label = `${count} need you`

  if (total === 0) {
    return compact ? null : <Pill tone="ok">Nothing needs you</Pill>
  }

  return (
    <Popover
      label="Needs you"
      align="start"
      width={`min(420px, calc(100vw - ${space[12]}))`}
      open={open}
      onOpenChange={setOpen}
      trigger={
        compact ? (
          <Trigger type="button" aria-label={label} data-focus-key="needs-you">
            <i aria-hidden="true">?</i>
            {count}
          </Trigger>
        ) : (
          <Trigger type="button" data-focus-key="needs-you">
            <i aria-hidden="true">?</i>
            {label}
            <span aria-hidden="true">▾</span>
          </Trigger>
        )
      }
    >
      <Body>
        <Head>
          <Title>
            Needs you
            <Count value={total} tone="warn" />
          </Title>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close Needs you"
            onClick={() => setOpen(false)}
          >
            ×
          </Button>
        </Head>
        {/* The header stays mounted across navigation, so close once an item is chosen. */}
        <NeedsYouList attention={attention} onChoose={() => setOpen(false)} />
      </Body>
    </Popover>
  )
}

/** The design's warn pill: a question glyph, the count and a caret, with no border. */
const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[1]} ${space[5]} ${space[1]} ${space[4]};
  border: 0;
  border-radius: ${radius.pill};
  background: ${color.warnWeak};
  color: ${color.warn};
  ${type.pill}
  cursor: pointer;
  ${hoverTransition}
  i {
    font-style: normal;
  }
  &:hover,
  &[data-state='open'] {
    filter: brightness(0.96);
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const Body = styled.div`
  display: grid;
`

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  padding: ${space[3]} ${space[4]} ${space[3]} ${space[6]};
`

const Title = styled.h2`
  display: inline-flex;
  align-items: center;
  gap: ${space[4]};
  margin: 0;
  ${type.bodyStrong}
`

import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import type { AttentionItemDto, BatchAttentionDto } from '@invimport/contracts'
import styled, { keyframes } from 'styled-components'
import { color, radius, shadow, space, type } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { NeedsYou } from '../ui/NeedsYou'
import { Pill } from '../ui/Pill'

const GROUPS: { tab: AttentionItemDto['tab']; title: string }[] = [
  { tab: 'processing', title: 'Processing' },
  { tab: 'review', title: 'Review' },
  { tab: 'changes', title: 'Changes' },
]

const GROUP_WORD: Record<AttentionItemDto['group'], string> = {
  question: 'Question',
  failed_job: 'Failed',
  changed_lot: 'Changed',
  decision: 'Decide',
  result: 'Result',
}

/** Every open item in the batch, grouped by the tab that owns it. */
export function NeedYouPanel({ attention }: { attention: BatchAttentionDto }) {
  const [open, setOpen] = useState(false)
  const total = attention.items.length
  const label = attention.items_truncated ? `${total}+ need you` : `${total} need you`

  if (total === 0) {
    return <Pill tone="ok">Nothing needs you</Pill>
  }

  return (
    <Popover.Root modal={false} open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Trigger type="button">
          <span aria-hidden="true">!</span>
          {label}
        </Trigger>
      </Popover.Trigger>
      <Popover.Portal>
        <Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Needs you"
          // The header stays mounted across navigation, so close once an item is chosen.
          onClick={(event) => {
            if ((event.target as Element).closest('a')) {
              setOpen(false)
            }
          }}
        >
          {GROUPS.map(({ tab, title }) => {
            const items = attention.items.filter((item) => item.tab === tab)
            if (items.length === 0) {
              return null
            }

            return (
              <Group key={tab} aria-label={title}>
                <Heading>{title}</Heading>
                <NeedsYou
                  items={items.map((item) => ({
                    id: item.key,
                    title: item.title,
                    assumption: item.detail ?? '',
                    step: GROUP_WORD[item.group],
                    href: `#${item.route}`,
                  }))}
                />
              </Group>
            )
          })}
          {attention.items_truncated && (
            <More>Showing the first {total}. Each tab shows the rest.</More>
          )}
        </Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const appear = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
`

const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
  min-height: 32px;
  padding: 3px ${space[6]};
  border: 1px solid ${color.warn};
  border-radius: ${radius.pill};
  background: ${color.warnWeak};
  color: ${color.warn};
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  ${media.compact} {
    min-height: 44px;
  }
`

const Content = styled(Popover.Content)`
  z-index: 1000;
  display: grid;
  gap: ${space[4]};
  width: min(420px, calc(100vw - 24px));
  max-height: min(70vh, var(--radix-popover-content-available-height));
  overflow: auto;
  padding: ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.popover};
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  animation: ${appear} 120ms ease-out;
  ${media.reducedMotion} {
    animation: none;
  }
`

const Group = styled.section``

const Heading = styled.h3`
  margin: ${space[2]} ${space[6]};
  ${type.label}
  color: ${color.muted};
`

const More = styled.p`
  margin: 0;
  padding: ${space[4]} ${space[6]};
  font-size: 12.5px;
  color: ${color.muted};
`

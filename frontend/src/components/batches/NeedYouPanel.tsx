import { useState } from 'react'
import type { AttentionItemDto, BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, size, space, type, typeVar } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { hoverTransition } from '../ui/motion'
import { NeedsYou } from '../ui/NeedsYou'
import { Pill } from '../ui/Pill'
import { Popover } from '../ui/Popover'

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
    <Popover
      label="Needs you"
      width={`min(420px, calc(100vw - ${space[12]}))`}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Trigger type="button">
          <i aria-hidden="true">?</i>
          {label}
          <span aria-hidden="true">▾</span>
        </Trigger>
      }
    >
      <Body>
        {GROUPS.map(({ tab, title }) => {
          const items = attention.items.filter((item) => item.tab === tab)
          if (items.length === 0) {
            return null
          }

          return (
            <Group key={tab} aria-label={title}>
              <Heading>{title}</Heading>
              <NeedsYou
                // The header stays mounted across navigation, so close once an item is chosen.
                onChoose={() => setOpen(false)}
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
  gap: ${space[4]};
  padding: ${space[2]};
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
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

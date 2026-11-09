import { useState } from 'react'
import type { AttentionItemDto, BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, size, space, type, typeVar } from '#/theme/generated/tokens'
import {
  media,
  hoverTransition,
  Button,
  NeedsYou,
  type NeedsYouItem,
  Count,
  Pill,
  Popover,
} from '#/components/ui'

type Tab = AttentionItemDto['tab']
type Group = AttentionItemDto['group']

const TABS: { tab: Tab; title: string }[] = [
  { tab: 'processing', title: 'Processing' },
  { tab: 'review', title: 'Review' },
  { tab: 'changes', title: 'Changes' },
]

const KINDS: { group: Group; title: string }[] = [
  { group: 'question', title: 'Questions' },
  { group: 'failed_job', title: 'Failed attempts' },
  { group: 'changed_lot', title: 'Lots' },
  { group: 'decision', title: 'Records' },
  { group: 'result', title: 'Results' },
]

/** What following each kind of item does, and the tone marker for kinds without a step. */
const KIND: Record<Group, Pick<NeedsYouItem, 'action' | 'mark'>> = {
  question: { action: 'Answer' },
  failed_job: { action: 'Open', mark: { tone: 'bad', glyph: '×', word: 'Failed' } },
  changed_lot: {
    action: 'Check',
    mark: { tone: 'warn', glyph: '!', word: 'Changed since review' },
  },
  decision: { action: 'Decide', mark: { tone: 'warn', glyph: '?', word: 'To decide' } },
  result: { action: 'Open', mark: { tone: 'bad', glyph: '×', word: 'Needs a check' } },
}

/** A question's step, from its route (`<batch>/processing/<step>/…`). */
function stepOf(item: AttentionItemDto) {
  const [, tab, step] = item.route.split('/')
  if (tab !== 'processing' || !step) {
    return undefined
  }

  return step.charAt(0).toUpperCase() + step.slice(1)
}

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
        {TABS.flatMap(({ tab, title }) =>
          KINDS.map(({ group, title: kind }) => {
            const items = attention.items.filter((item) => item.tab === tab && item.group === group)
            if (items.length === 0) {
              return null
            }

            const heading = `${kind} · ${title}`
            return (
              <Section key={`${tab}:${group}`} aria-label={heading}>
                <Heading>{heading}</Heading>
                <NeedsYou
                  // The header stays mounted across navigation, so close once an item is chosen.
                  onChoose={() => setOpen(false)}
                  items={items.map((item) => ({
                    id: item.key,
                    title: item.title,
                    assumption: item.detail ?? '',
                    step: group === 'question' ? stepOf(item) : undefined,
                    ...KIND[group],
                    href: `#${item.route}`,
                  }))}
                />
              </Section>
            )
          }),
        )}
        <Footer>
          {attention.items_truncated && `Showing the first ${total}. Each tab shows the rest. `}
          Each item opens the tab that owns it. Agents keep working while these wait.
        </Footer>
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

const Section = styled.section``

const Heading = styled.h3`
  margin: 0;
  padding: ${space[5]} ${space[6]} ${space[3]};
  ${type.label}
  color: ${color.muted};
`

const Footer = styled.p`
  margin: 0;
  padding: ${space[5]} ${space[6]};
  border-top: 1px solid ${color.line};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

import type { AttentionItemDto, BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { assumptionLine, questionKindLabel } from '#/processing/question-summary'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import { NeedsYou, type NeedsYouItem } from '#/components/ui'

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

/** A question's kind or step count and its assumptions; other items keep their detail. */
function questionDetail(item: AttentionItemDto) {
  const steps = item.question?.steps
  if (!steps) {
    return { assumption: item.detail ?? '' }
  }

  return {
    kind: questionKindLabel(steps),
    assumption: assumptionLine(steps.map((step) => step.assumption)) ?? '',
  }
}

type NeedsYouListProps = {
  attention: BatchAttentionDto
  /** Runs when an item's link is followed, e.g. to close the panel holding the list. */
  onChoose?: () => void
}

/**
 * Every open item in the batch's attention read, agent questions first, grouped and tagged by the
 * tab that owns it. The header popover and Processing's Overview share it, so both agree.
 */
export function NeedsYouList({ attention, onChoose }: NeedsYouListProps) {
  const total = attention.items.length
  if (total === 0) {
    return <Empty>Nothing needs you.</Empty>
  }

  return (
    <>
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
                onChoose={onChoose}
                items={items.map((item) => ({
                  id: item.key,
                  title: item.title,
                  ...questionDetail(item),
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
    </>
  )
}

const Empty = styled.p`
  margin: 0;
  ${type.small}
  color: ${color.muted};
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

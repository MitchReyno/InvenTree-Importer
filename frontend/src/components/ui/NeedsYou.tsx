import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { Button } from './Button'
import { Pill } from './Pill'
import { VisuallyHidden } from './VisuallyHidden'

/** A tone marker in place of the step chip: its glyph shows, its word is read. */
export type NeedsYouMark = { tone: 'warn' | 'bad'; glyph: string; word: string }

export type NeedsYouItem = {
  id: string
  thumb?: string
  title: string
  assumption: string
  step?: string
  mark?: NeedsYouMark
  /** The link's verb, "Answer" unless the item is not a question. */
  action?: string
  href: string
}

/** Questions and decisions waiting on the operator; each links to the page that owns it. */
/** `onChoose` runs when an item's Answer link is followed, e.g. to close the panel holding it. */
export function NeedsYou({ items, onChoose }: { items: NeedsYouItem[]; onChoose?: () => void }) {
  if (items.length === 0) {
    return <Empty>Nothing needs you right now.</Empty>
  }

  return (
    <List>
      {items.map((item) => (
        <li key={item.id}>
          {item.thumb && (
            <Thumb aria-hidden="true" data-thumb>
              <img src={item.thumb} alt="" />
            </Thumb>
          )}
          {item.step && <StepChip>{item.step}</StepChip>}
          {item.mark && (
            <Mark>
              <Pill tone={item.mark.tone} glyph={item.mark.glyph}>
                <VisuallyHidden>{item.mark.word}</VisuallyHidden>
              </Pill>
            </Mark>
          )}
          <Text>
            <Title>{item.title}</Title>
            <Assumption>{item.assumption}</Assumption>
          </Text>
          <Button
            as="a"
            href={item.href}
            onClick={onChoose}
            size="sm"
            variant="primary"
            aria-label={`${item.action ?? 'Answer'}: ${item.title}`}
          >
            {item.action ?? 'Answer'}
          </Button>
        </li>
      ))}
    </List>
  )
}

const List = styled.ul`
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  /* The thumbnail, the leading chip or mark, the text and the action each keep their own column,
     so a wrapping title never runs under the chip. */
  li {
    display: flex;
    align-items: center;
    gap: ${space[5]};
    padding: ${space[5]} ${space[6]};
    border-top: 1px solid ${color.line};
  }
  li > * {
    flex: none;
  }
  li:first-child {
    border-top: 0;
  }
`

const Thumb = styled.span`
  /* literal-allowed: the canvas's 4:3 row thumbnail; no thumbnail size token */
  width: 44px;
  height: 34px;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.thumb};
  background: ${color.photoStage};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const Text = styled.span`
  flex: 1 1 auto;
  min-width: 0;
`

const StepChip = styled.span`
  display: inline-flex;
  padding: ${space[1]} calc(${space[5]} - 1px);
  border-radius: ${radius.pill};
  background: ${color.surface2};
  color: ${color.muted};
  font-size: ${typeVar.pill.size};
`

const Mark = styled.span`
  display: inline-flex;
`

const Title = styled.b`
  font-weight: ${typeVar.bodyStrong.weight};
`

const Assumption = styled.span`
  display: block;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Empty = styled.p`
  margin: 0;
  padding: ${space[5]} ${space[6]};
  color: ${color.muted};
`

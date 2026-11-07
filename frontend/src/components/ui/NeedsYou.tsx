import styled from 'styled-components'
import { color, radius, space, typeVar } from '../../theme/generated/tokens'
import { Button } from './Button'

export type NeedsYouItem = {
  id: string
  thumb?: string
  title: string
  assumption: string
  step?: string
  href: string
}

/** Questions and decisions waiting on the operator; each links to the page that owns it. */
export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  if (items.length === 0) {
    return <Empty>Nothing needs you right now.</Empty>
  }

  return (
    <List>
      {items.map((item) => (
        <li key={item.id}>
          <Thumb aria-hidden="true">{item.thumb && <img src={item.thumb} alt="" />}</Thumb>
          <span>
            {item.step && <StepChip>{item.step}</StepChip>}
            <Title>{item.title}</Title>
            <Assumption>{item.assumption}</Assumption>
          </span>
          <Button
            as="a"
            href={item.href}
            size="sm"
            variant="primary"
            aria-label={`Answer: ${item.title}`}
          >
            Answer
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
  li {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: center;
    gap: ${space[5]};
    padding: ${space[5]} ${space[6]};
    border-top: 1px solid ${color.line};
  }
  li:first-child {
    border-top: 0;
  }
`

const Thumb = styled.span`
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

const StepChip = styled.span`
  display: inline-flex;
  margin-right: ${space[3]};
  padding: ${space[1]} calc(${space[5]} - 1px);
  border-radius: ${radius.pill};
  background: ${color.surface2};
  color: ${color.muted};
  font-size: ${typeVar.pill.size};
`

const Title = styled.b`
  font-weight: ${typeVar.bodyStrong.weight};
`

const Assumption = styled.span`
  display: block;
  font-size: 12px;
  color: ${color.muted};
`

const Empty = styled.p`
  margin: 0;
  padding: ${space[5]} ${space[6]};
  color: ${color.muted};
`

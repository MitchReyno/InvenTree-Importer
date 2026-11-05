import styled from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { Pill } from './Pill'

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
            <a href={item.href}>{item.title}</a>
            <Assumption>{item.assumption}</Assumption>
          </span>
          {item.step ? <Pill tone="warn">{item.step}</Pill> : <span />}
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
    gap: ${space['2-5']};
    padding: ${space['2-5']} ${space[3]};
    border-top: 1px solid ${color.line};
  }
  li:first-child {
    border-top: 0;
  }
  a {
    font-weight: 600;
    color: ${color.fg};
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

const Assumption = styled.span`
  display: block;
  font-size: 12px;
  color: ${color.muted};
`

const Empty = styled.p`
  margin: 0;
  padding: ${space['2-5']} ${space[3]};
  color: ${color.muted};
`

import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'

export type Closeup = { label: string; image: string }

type QuestionCardProps = {
  question: string
  why: string
  /** The assumption the agent is working with until the operator answers. */
  assumption: string
  closeups?: Closeup[]
  answer: ReactNode
  secondary?: ReactNode
}

export function QuestionCard({
  question,
  why,
  assumption,
  closeups = [],
  answer,
  secondary,
}: QuestionCardProps) {
  return (
    <Card>
      <Question>
        <Icon aria-hidden="true">?</Icon>
        <span>{question}</span>
      </Question>
      <Why>{why}</Why>
      <Body>
        {closeups.length > 0 && (
          <Closeups>
            {closeups.map((closeup) => (
              <figure key={closeup.label}>
                <img src={closeup.image} alt={closeup.label} />
                <figcaption aria-hidden="true">{closeup.label}</figcaption>
              </figure>
            ))}
          </Closeups>
        )}
        <Assumption>{assumption}</Assumption>
        {answer}
        {secondary}
      </Body>
    </Card>
  )
}

const Card = styled.fieldset`
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid ${color.warn};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Icon = styled.span`
  font-weight: 700;
  color: ${color.warn};
`

const Question = styled.legend`
  float: left;
  display: flex;
  align-items: flex-start;
  gap: ${space[4]};
  width: 100%;
  padding: ${space[5]} ${space[7]} ${space[2]};
  background: ${color.warnWeak};
  ${type.h3}
`

const Why = styled.p`
  clear: both;
  margin: 0;
  padding: 0 ${space[7]} ${space[5]} calc(${space[7]} + 18px);
  background: ${color.warnWeak};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[6]};
  padding: ${space[6]} ${space[7]};
`

const Closeups = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space[4]};
  figure {
    position: relative;
    margin: 0;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border: 1px solid ${color.line};
    border-radius: ${radius.input};
    background: ${color.photoStage};
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  figcaption {
    position: absolute;
    left: ${space[2]};
    bottom: ${space[2]};
    padding: 1px ${space[3]};
    border-radius: ${radius.sm};
    background: ${color.photoScrim};
    color: ${color.photoFg};
    font-size: ${typeVar.label.size};
  }
`

const Assumption = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
`

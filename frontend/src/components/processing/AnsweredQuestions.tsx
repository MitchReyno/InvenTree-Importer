import styled from 'styled-components'
import { Pill } from '#/components/ui'
import type { AnsweredItem } from '#/processing/answered-items'
import { color, space, type } from '#/theme/generated/tokens'
import { AnsweredQuestion } from './AnsweredQuestion'

/**
 * The "Answered" group below the open questions, newest first. Its heading takes focus when an
 * answer leaves no open question to move to.
 */
export function AnsweredQuestions({
  items,
  lotLabel,
}: {
  items: AnsweredItem[]
  lotLabel: (lotId: string) => string
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <Group aria-label="Answered">
      <Heading tabIndex={-1} data-answered-heading>
        Answered{' '}
        <Pill tone="neutral" glyph="">
          {items.length}
        </Pill>
      </Heading>
      <List>
        {items.map((item) => (
          <li key={item.line.questionId}>
            <AnsweredQuestion {...item} lotLabel={lotLabel} />
          </li>
        ))}
      </List>
    </Group>
  )
}

const Group = styled.section`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
`

const Heading = styled.h3`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  margin: 0;
  ${type.label}
  color: ${color.muted};
  > * {
    text-transform: none;
    letter-spacing: 0;
  }
`

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[4]};
`

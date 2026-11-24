import styled from 'styled-components'
import { linkTouchArea, raisedOnField } from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'
import type { SourceQuestion } from '#/processing/source'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'

export const STEP_LABEL: Record<string, string> = {
  examine: 'Examine',
  research: 'Research',
  images: 'Images',
  inventory: 'Inventory',
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

export function QuestionRows({
  batchId,
  questions,
}: {
  batchId: string
  questions: SourceQuestion[]
}) {
  return (
    <Rows>
      {questions.map((question) => (
        <li key={question.id}>
          <span>
            <a
              data-question-row={question.id}
              href={batchHref(batchId, {
                tab: 'processing',
                step: question.step,
                questionId: question.id,
              })}
            >
              {question.title}
            </a>
            <Muted>
              {STEP_LABEL[question.step]} · {question.subject} · {question.kind}
              {question.assumption && ` · ${question.assumption}`}
            </Muted>
          </span>
          {question.lotId && (
            <a
              aria-label={`Open in Review: ${question.subject}`}
              href={batchHref(batchId, { tab: 'review', view: 'lots', lotId: question.lotId })}
            >
              Open in Review
            </a>
          )}
        </li>
      ))}
    </Rows>
  )
}

export const Card = styled.section`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
  /* Agent text, such as a question's prompt or assumption, can hold a long unbroken word. */
  overflow-wrap: anywhere;
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`

export const CardTitle = styled.h2`
  margin: 0;
  ${type.h2}
`

export const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[4]};
    padding: ${space[4]} 0;
    border-top: 1px solid ${color.line};
    overflow-wrap: anywhere;
  }
  li:first-child {
    border-top: 0;
  }
  li > :first-child {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  a {
    color: ${color.fg};
    font-weight: ${typeVar.bodyStrong.weight};
    ${linkTouchArea}
  }
`

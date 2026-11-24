import styled from 'styled-components'
import { questionView, type ProcessingQuestionDto } from '@invimport/contracts'
import { CheckIcon, ClockIcon, EventTime, Link, VisuallyHidden } from '#/components/ui'
import type { AnsweredIcon, AnsweredLine } from '#/processing/answered-line'
import { answerEffectsSentence } from '#/processing/question-summary'
import { color, icon, radius, space, typeVar } from '#/theme/generated/tokens'

type Props = {
  line: AnsweredLine
  question: ProcessingQuestionDto
  /** The asking session's stage name: "Examine". */
  stage: string
  /** The job's session page, linked when its history exists. */
  sessionHref: string
  /** The lot the question is about, when it is a live lot. */
  lot?: { label: string; href: string }
  lotLabel: (lotId: string) => string
}

const ICON_NAME: Record<AnsweredIcon, string> = {
  clock: 'Not read yet',
  tick: 'Read',
  saved: 'Saved',
  answered: 'Answered',
}

function LineIcon({ kind }: { kind: AnsweredIcon }) {
  return (
    <Glyph $kind={kind}>
      {kind === 'clock' ? <ClockIcon /> : <CheckIcon />}
      <VisuallyHidden>{ICON_NAME[kind]}</VisuallyHidden>
    </Glyph>
  )
}

/**
 * An answered question folded to one line: what was answered and whether the session has read
 * it. It expands to the question, the assumption it replaced, the answer, what it changed, when
 * it was sent and read, and links to the session and the lot.
 */
export function AnsweredQuestion({ line, question, stage, sessionHref, lot, lotLabel }: Props) {
  const view = questionView(question)
  const assumptions = view.steps.flatMap((step) => (step.assumption ? [step.assumption] : []))
  const changed = answerEffectsSentence(line.effects, lotLabel)

  return (
    <Line id={`answered-${line.questionId}`} data-answered-question={line.questionId}>
      <summary>
        <LineIcon kind={line.icon} />
        <Title>{line.title}</Title>
        <Said>
          {line.answer && (
            <>
              <Muted>{line.answer.verb}</Muted> <b>{line.answer.text}</b>
              {line.status && <Muted> · </Muted>}
            </>
          )}
          {line.status && <Muted>{line.status}</Muted>}
          {line.readAt && (
            <Muted>
              {' '}
              <EventTime at={line.readAt} />
            </Muted>
          )}
        </Said>
        {line.answeredAt && (
          <When>
            <EventTime at={line.answeredAt} />
          </When>
        )}
      </summary>
      <Body>
        <Facts>
          <dt>Asked</dt>
          <dd>
            {view.title} <Muted>{view.reason}</Muted>
          </dd>
          {assumptions.length > 0 && (
            <>
              <dt>It assumed</dt>
              <dd>
                <Muted>
                  <s>{assumptions.join(' · ')}</s>
                </Muted>
              </dd>
            </>
          )}
          <dt>Your answer</dt>
          <dd>
            {line.values ? (
              <Values>
                {line.values.map((value, index) => (
                  <li key={value.step_id ?? index}>
                    {line.values!.length > 1 && <Muted>{value.prompt} — </Muted>}
                    <b>{value.truncated ? `${value.text}…` : value.text}</b>
                  </li>
                ))}
              </Values>
            ) : (
              <Muted>
                {line.sessionHistory ? 'Shown in the session.' : 'Its details aren’t shown here.'}
              </Muted>
            )}
          </dd>
          {changed && (
            <>
              <dt>Changed</dt>
              <dd>{changed}</dd>
            </>
          )}
        </Facts>
        {(line.answeredAt || line.delivery) && (
          <Trail aria-label="Delivery">
            {line.answeredAt && (
              <li>
                <Dot $done />
                <span>You sent it</span>
                <EventTime at={line.answeredAt} />
              </li>
            )}
            {line.delivery && (
              <li>
                <Dot $done={line.delivery.state === 'read'} />
                <span>
                  {line.delivery.state === 'read'
                    ? `${stage} read it`
                    : `${stage} hasn’t read it yet`}
                </span>
                {line.readAt ? <EventTime at={line.readAt} /> : <span />}
              </li>
            )}
          </Trail>
        )}
        <Links>
          {line.sessionHistory && <Link href={sessionHref}>See it in the session</Link>}
          {lot && <Link href={lot.href}>{lot.label}</Link>}
        </Links>
      </Body>
    </Line>
  )
}

const Line = styled.details`
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  min-width: 0;
  > summary {
    list-style: none;
    display: grid;
    grid-template-columns: ${icon.md} minmax(0, 1fr) auto;
    gap: ${space[1]} ${space[5]};
    align-items: center;
    padding: ${space[5]} ${space[7]};
    cursor: pointer;
  }
  > summary::-webkit-details-marker {
    display: none;
  }
`

const Glyph = styled.span<{ $kind: AnsweredIcon }>`
  display: inline-grid;
  place-items: center;
  width: ${icon.md};
  height: ${icon.md};
  border-radius: ${radius.round};
  background: ${({ $kind }) => ($kind === 'clock' ? color.surface2 : color.okWeak)};
  color: ${({ $kind }) => ($kind === 'clock' ? color.muted : color.ok)};
  svg {
    width: ${icon.sm};
    height: ${icon.sm};
  }
`

const Title = styled.b`
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: ${typeVar.body.size};
`

const Said = styled.span`
  grid-column: 2;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: ${typeVar.small.size};
`

const When = styled.span`
  grid-column: 3;
  grid-row: 1;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  white-space: nowrap;
`

const Muted = styled.span`
  color: ${color.muted};
`

const Body = styled.div`
  display: grid;
  gap: ${space[5]};
  padding: ${space[6]} ${space[7]} ${space[7]};
  border-top: 1px solid ${color.line};
  font-size: ${typeVar.body.size};
`

const Facts = styled.dl`
  display: grid;
  grid-template-columns: minmax(0, 7.5rem) minmax(0, 1fr);
  gap: ${space[3]} ${space[6]};
  margin: 0;
  dt {
    color: ${color.muted};
    font-size: ${typeVar.small.size};
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
`

const Values = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[2]};
`

const Trail = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[3]};
  font-size: ${typeVar.small.size};
  li {
    display: grid;
    grid-template-columns: ${icon.sm} minmax(0, 1fr) auto;
    gap: ${space[4]};
    align-items: center;
  }
  time {
    color: ${color.muted};
  }
`

const Dot = styled.span<{ $done: boolean }>`
  justify-self: center;
  width: ${space[4]};
  height: ${space[4]};
  border-radius: ${radius.round};
  box-sizing: border-box;
  background: ${({ $done }) => ($done ? color.ok : 'transparent')};
  border: ${({ $done }) => ($done ? '0' : `2px solid ${color.muted}`)};
`

const Links = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[6]};
  font-size: ${typeVar.small.size};
  &:empty {
    display: none;
  }
`

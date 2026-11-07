import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type } from '../../theme/generated/tokens'

export type ProblemSeverity = 'blocking' | 'warning'

export type ProblemIssue = { title: string; text: string; actions?: ReactNode }

type ProblemCardProps = {
  severity: ProblemSeverity
  title: string
  summary?: string
  issues: ProblemIssue[]
}

const SEVERITY_WORD: Record<ProblemSeverity, string> = {
  blocking: 'Blocking',
  warning: 'Warning',
}

export function ProblemCard({ severity, title, summary, issues }: ProblemCardProps) {
  const word = SEVERITY_WORD[severity]

  return (
    <Card aria-label={`${word}: ${title}`} $severity={severity}>
      <Header>
        <Icon aria-hidden="true" $severity={severity}>
          {severity === 'blocking' ? '×' : '!'}
        </Icon>
        <Title>{title}</Title>
        <Severity>{word}</Severity>
        {summary && <Summary>{summary}</Summary>}
      </Header>
      {issues.map((issue) => (
        <Issue key={issue.title}>
          <strong>{issue.title}</strong>
          <span>{issue.text}</span>
          {issue.actions && <Actions>{issue.actions}</Actions>}
        </Issue>
      ))}
    </Card>
  )
}

export type Problem = ProblemCardProps & { id: string }

/** Blocking problems come first so the operator sees what stops progress. */
export function ProblemList({ problems }: { problems: Problem[] }) {
  const ordered = [...problems].sort(
    (first, second) =>
      Number(first.severity !== 'blocking') - Number(second.severity !== 'blocking'),
  )

  return (
    <List>
      {ordered.map(({ id, ...problem }) => (
        <ProblemCard key={id} {...problem} />
      ))}
    </List>
  )
}

const Card = styled.section<{ $severity: ProblemSeverity }>`
  overflow: hidden;
  border: 1px solid ${({ $severity }) => ($severity === 'blocking' ? color.bad : color.warn)};
  border-radius: ${radius.card};
  background: ${({ $severity }) => ($severity === 'blocking' ? color.badWeak : color.warnWeak)};
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[2]} ${space[4]};
  padding: ${space[4]} ${space[6]};
`

const Icon = styled.span<{ $severity: ProblemSeverity }>`
  width: 14px;
  font-weight: 700;
  text-align: center;
  color: ${({ $severity }) => ($severity === 'blocking' ? color.bad : color.warn)};
`

const Title = styled.h3`
  margin: 0;
  ${type.h3}
`

const Severity = styled.span`
  font-size: 12.5px;
  font-weight: 600;
`

const Summary = styled.span`
  font-size: 12.5px;
  color: ${color.muted};
`

const Issue = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[4]} ${space[6]};
  border-top: 1px solid ${color.line};
  background: ${color.surface};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[5]};
`

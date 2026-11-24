import type { SessionHistoryDetailsDto } from '@invimport/contracts'
import { DetailLabel, Muted } from './history-styles'

type Details = Extract<SessionHistoryDetailsDto, { kind: 'question' }>

const STATE = { open: 'Open', answered: 'Answered', superseded: 'Superseded' }

/** A question's state and each step's prompt with the assumption the agent works on meanwhile. */
export function QuestionDetails({ details }: { details: Details }) {
  const steps =
    'steps' in details.question
      ? details.question.steps
      : [{ id: 'only', prompt: details.question.prompt, assumption: details.question.assumption }]
  return (
    <>
      <DetailLabel>{STATE[details.state]}</DetailLabel>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            {step.prompt} <Muted>Assuming {step.assumption} until you answer.</Muted>
          </li>
        ))}
      </ol>
    </>
  )
}

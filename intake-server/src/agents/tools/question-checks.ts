import type { SessionAskArgsV2Dto, ValidationIssue } from '@invimport/contracts'

/** Why an ask can't be stored, naming the step; the agent corrects it and asks again. */
export interface StepRefusal {
  message: string
  issue: ValidationIssue
}

function stepName(index: number, id: string) {
  return `Step ${index + 1} (${id})`
}

function duplicateIds(ask: SessionAskArgsV2Dto): StepRefusal | null {
  const stepIds = new Set<string>()
  for (const [index, step] of ask.steps.entries()) {
    if (stepIds.has(step.id)) {
      return {
        message: `${stepName(index, step.id)} repeats an earlier step ID. Give each step its own ID.`,
        issue: {
          path: `/steps/${index}/id`,
          rule: 'uniqueItems',
          reason: 'Step IDs must be unique within a question.',
        },
      }
    }
    stepIds.add(step.id)
    if (step.answer.kind !== 'choice') {
      continue
    }
    const optionIds = new Set<string>()
    for (const [optionIndex, option] of step.answer.options.entries()) {
      if (optionIds.has(option.id)) {
        return {
          message: `${stepName(index, step.id)} repeats the option ID ${option.id}. Give each option its own ID.`,
          issue: {
            path: `/steps/${index}/answer/options/${optionIndex}/id`,
            rule: 'uniqueItems',
            reason: 'Option IDs must be unique within a step.',
          },
        }
      }
      optionIds.add(option.id)
    }
  }
  return null
}

/** A number is a lot's quantity: one per question, about a live lot, affecting `quantity`. */
function numberStepProblem(ask: SessionAskArgsV2Dto, liveLots: ReadonlySet<string>) {
  const numberSteps = [...ask.steps.entries()].filter(([, step]) => step.answer.kind === 'number')
  if (numberSteps.length > 1) {
    const [index, step] = numberSteps[1]
    return {
      message: `${stepName(index, step.id)} is a second number step. A question has one subject, so ask at most one number.`,
      issue: {
        path: `/steps/${index}/answer/kind`,
        rule: 'schema',
        reason: 'A question has at most one number step.',
      },
    }
  }
  if (!numberSteps.length) {
    return null
  }
  const [index, step] = numberSteps[0]
  if (ask.subject_id === null || !liveLots.has(ask.subject_id)) {
    return {
      message: `${stepName(index, step.id)} asks for a number, which is a lot's quantity, but the question is not about one live lot.`,
      issue: {
        path: `/steps/${index}/answer/kind`,
        rule: 'schema',
        reason: 'A number step needs a question about one live lot.',
      },
    }
  }
  if (!ask.fields.includes('quantity')) {
    return {
      message: `${stepName(index, step.id)} asks for a quantity, so list quantity in the question's fields.`,
      issue: {
        path: '/fields',
        rule: 'schema',
        reason: 'A question with a number step must list quantity.',
      },
    }
  }
  return null
}

/** The checks a schema can't make: unique IDs and the number step's subject and field. */
export function stepRefusal(
  ask: SessionAskArgsV2Dto,
  liveLots: ReadonlySet<string>,
): StepRefusal | null {
  return duplicateIds(ask) ?? numberStepProblem(ask, liveLots)
}

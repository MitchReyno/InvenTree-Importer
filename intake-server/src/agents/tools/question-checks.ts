import type { SessionAskArgsV2Dto, ValidationIssue } from '@invimport/contracts'
import { storableText } from '#/db/storable-text.ts'

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

/** Every free-text field of an ask with its path, in the order an agent wrote them. */
function askTexts(ask: SessionAskArgsV2Dto): [string, string][] {
  const texts: [string, string][] = [['/reason', ask.reason]]
  if (ask.title !== undefined) {
    texts.push(['/title', ask.title])
  }
  for (const [index, step] of ask.steps.entries()) {
    texts.push(
      [`/steps/${index}/prompt`, step.prompt],
      [`/steps/${index}/assumption`, step.assumption],
    )
    if (step.answer.kind !== 'choice') {
      continue
    }
    for (const [optionIndex, option] of step.answer.options.entries()) {
      const at = `/steps/${index}/answer/options/${optionIndex}`
      texts.push([`${at}/label`, option.label])
      if (option.detail !== undefined) {
        texts.push([`${at}/detail`, option.detail])
      }
    }
  }
  return texts
}

/** PostgreSQL reads the stored question as jsonb, which refuses NUL and unpaired surrogates. */
function unstorableText(ask: SessionAskArgsV2Dto): StepRefusal | null {
  const found = askTexts(ask).find(([, text]) => !storableText(text))
  if (!found) {
    return null
  }
  return {
    message: `The text at ${found[0]} holds a character that can't be stored. Remove it and retry.`,
    issue: {
      path: found[0],
      rule: 'schema',
      reason: 'Text must not hold NUL or unpaired surrogates.',
    },
  }
}

/** The question's subject must be this session's lot, or for the lead session one of its batch. */
export function subjectRefusal(ask: SessionAskArgsV2Dto): StepRefusal {
  const numberStep = ask.steps.findIndex((step) => step.answer.kind === 'number')
  const numberNote =
    numberStep >= 0
      ? ` ${stepName(numberStep, ask.steps[numberStep].id)} asks for a number, so name one live lot.`
      : ''
  return {
    message: `A question must be about this session’s lot.${numberNote}`,
    issue: {
      path: '/subject_id',
      rule: 'schema',
      reason: 'Name this session’s lot, or for the lead session a subject of its batch.',
    },
  }
}

/** The checks a schema can't make: storable text, unique IDs and the number step's subject. */
export function stepRefusal(
  ask: SessionAskArgsV2Dto,
  liveLots: ReadonlySet<string>,
): StepRefusal | null {
  return unstorableText(ask) ?? duplicateIds(ask) ?? numberStepProblem(ask, liveLots)
}

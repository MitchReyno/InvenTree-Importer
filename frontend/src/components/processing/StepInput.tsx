import styled from 'styled-components'
import type { QuestionViewStep } from '@invimport/contracts'
import { Banner, SegmentedControl } from '#/components/ui'
import { Input, Label, OptionRow, TextArea } from '#/forms'
import { color, space, typeVar } from '#/theme/generated/tokens'
import {
  NUMBER_FIX,
  OTHER_OPTION,
  STEP_TEXT_MAX_CHARACTERS,
  validQuantity,
  type NumberDraft,
  type StepDraft,
} from '#/processing/stepped-answer'

type StepInputProps = {
  step: QuestionViewStep
  draft: StepDraft
  /** Unique among the page's forms, for field IDs and radio names. */
  idPrefix: string
  /** Replaces the step's draft; the form reports the change to the navigation guard. */
  onChange: (draft: StepDraft) => void
  /** The server refused this step of an earlier send. */
  refusal?: string
}

/** One step's answer field: option cards, a quantity or text. */
export function StepInput({ step, draft, idPrefix, onChange, refusal }: StepInputProps) {
  const fixId = `${idPrefix}-fix`
  // A number is checked as it is typed; an empty field isn't wrong yet, only incomplete.
  const showFix =
    draft.kind === 'number' && !draft.inWords && draft.value !== '' && !validQuantity(draft.value)
  const refusalBanner = refusal && (
    <div role="alert">
      <Banner tone="bad">{refusal}</Banner>
    </div>
  )

  if (draft.kind === 'choice') {
    const answer = step.answer.kind === 'choice' ? step.answer : undefined
    // Picking an option chooses it; nothing is sent until Send.
    return (
      <>
        <Choices>
          <legend>Choose one</legend>
          <OptionRow
            name={`${idPrefix}-option`}
            options={(answer?.options ?? []).map((option) => ({
              id: option.id,
              title: option.label,
              detail: option.detail,
            }))}
            escape={answer?.other ? { id: OTHER_OPTION, title: 'Something else…' } : undefined}
            value={draft.option}
            onChange={(option) => onChange({ ...draft, option })}
          />
        </Choices>
        {draft.option === OTHER_OPTION && (
          <Field>
            <Label htmlFor={`${idPrefix}-other`}>In your own words</Label>
            <Input
              id={`${idPrefix}-other`}
              maxLength={STEP_TEXT_MAX_CHARACTERS}
              value={draft.other}
              onChange={(event) => onChange({ ...draft, other: event.target.value })}
            />
          </Field>
        )}
        {refusalBanner}
      </>
    )
  }

  if (draft.kind === 'number' && draft.inWords) {
    return (
      <>
        <Field>
          <Label htmlFor={`${idPrefix}-words`}>Your answer in words</Label>
          <TextArea
            id={`${idPrefix}-words`}
            maxLength={STEP_TEXT_MAX_CHARACTERS}
            value={draft.words}
            onChange={(event) => onChange({ ...draft, words: event.target.value })}
          />
        </Field>
        <Note>This answer reaches the agent and leaves the lot&rsquo;s quantity as it is.</Note>
        <LinkButton type="button" onClick={() => onChange({ ...draft, inWords: false })}>
          Give a number instead
        </LinkButton>
        {refusalBanner}
      </>
    )
  }

  if (draft.kind === 'number') {
    return (
      <>
        <Field>
          <Label htmlFor={`${idPrefix}-quantity`}>Quantity</Label>
          <Input
            id={`${idPrefix}-quantity`}
            inputMode="decimal"
            aria-invalid={showFix}
            aria-describedby={showFix ? fixId : undefined}
            value={draft.value}
            onChange={(event) => onChange({ ...draft, value: event.target.value })}
          />
        </Field>
        {showFix && (
          <div id={fixId} role="alert">
            <Banner tone="bad">{NUMBER_FIX}</Banner>
          </div>
        )}
        <SegmentedControl
          label="How was it found"
          options={[
            { id: 'counted', label: 'Counted' },
            { id: 'estimated', label: 'Estimated' },
          ]}
          value={draft.basis}
          onChange={(basis) => onChange({ ...draft, basis: basis as NumberDraft['basis'] })}
        />
        <LinkButton type="button" onClick={() => onChange({ ...draft, inWords: true })}>
          Can&rsquo;t give a number? Answer in words
        </LinkButton>
        {refusalBanner}
      </>
    )
  }

  return (
    <>
      <Field>
        <Label htmlFor={`${idPrefix}-text`}>Your answer</Label>
        <TextArea
          id={`${idPrefix}-text`}
          maxLength={STEP_TEXT_MAX_CHARACTERS}
          value={draft.text}
          onChange={(event) => onChange({ ...draft, text: event.target.value })}
        />
      </Field>
      {refusalBanner}
    </>
  )
}

const Choices = styled.fieldset`
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: ${space[3]};
  legend {
    padding: 0;
    margin-bottom: ${space[3]};
    font-size: ${typeVar.small.size};
    font-weight: ${typeVar.bodyStrong.weight};
  }
`

const Field = styled.div`
  display: grid;
  gap: ${space[4]};
`

const Note = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const LinkButton = styled.button`
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: ${color.accent};
  font: inherit;
  font-size: ${typeVar.small.size};
  text-decoration: underline;
  cursor: pointer;
`

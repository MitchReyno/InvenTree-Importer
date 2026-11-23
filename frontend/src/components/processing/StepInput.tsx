import styled from 'styled-components'
import { Controller, type Control, type UseFormRegister } from 'react-hook-form'
import type { QuestionViewStep } from '@invimport/contracts'
import { Banner, SegmentedControl } from '#/components/ui'
import { Input, Label, OptionRow, TextArea } from '#/forms'
import { color, space, typeVar } from '#/theme/generated/tokens'
import {
  NUMBER_FIX,
  OTHER_OPTION,
  STEP_TEXT_MAX_CHARACTERS,
  textTooLong,
  validQuantity,
  type StepDraft,
  type SteppedFields,
} from '#/processing/stepped-answer'

type StepInputProps = {
  step: QuestionViewStep
  /** The step's position in the form's `steps`. */
  index: number
  /** The step's current draft, as the form holds it. */
  draft: StepDraft
  register: UseFormRegister<SteppedFields>
  control: Control<SteppedFields>
  /** Unique among the page's forms, for field IDs and radio names. */
  idPrefix: string
  /** Runs after every edit, so the form reports it to the navigation guard at once. */
  onEdited: () => void
  /** The server refused this step of an earlier send. */
  refusal?: string
}

const LENGTH_FIX = `Keep it to ${STEP_TEXT_MAX_CHARACTERS} characters.`

/** One step's answer field: option cards, a quantity or text. */
export function StepInput({
  step,
  index,
  draft,
  register,
  control,
  idPrefix,
  onEdited,
  refusal,
}: StepInputProps) {
  const fixId = `${idPrefix}-fix`
  // A number is checked as it is typed; an empty field isn't wrong yet, only incomplete.
  const showFix =
    draft.kind === 'number' && !draft.inWords && draft.value !== '' && !validQuantity(draft.value)

  const textOf = (current: StepDraft) => {
    switch (current.kind) {
      case 'choice':
        return current.option === OTHER_OPTION ? current.other : ''
      case 'number':
        return current.inWords ? current.words : ''
      case 'text':
        return current.text
    }
  }

  // Counted in code points, as the contract counts them, rather than by a native maxLength.
  const tooLong = textTooLong(textOf(draft))
  const lengthFix = tooLong && (
    <div id={fixId} role="alert">
      <Banner tone="bad">{LENGTH_FIX}</Banner>
    </div>
  )
  const refusalBanner = refusal && (
    <div role="alert">
      <Banner tone="bad">{refusal}</Banner>
    </div>
  )

  const textField = (name: 'other' | 'words' | 'text') =>
    register(`steps.${index}.${name}`, { onChange: onEdited })

  if (draft.kind === 'choice') {
    const answer = step.answer.kind === 'choice' ? step.answer : undefined
    // Picking an option chooses it; nothing is sent until Send.
    return (
      <>
        <Choices>
          <legend>Choose one</legend>
          <Controller
            control={control}
            name={`steps.${index}.option`}
            render={({ field }) => (
              <OptionRow
                name={`${idPrefix}-option`}
                options={(answer?.options ?? []).map((option) => ({
                  id: option.id,
                  title: option.label,
                  detail: option.detail,
                }))}
                escape={answer?.other ? { id: OTHER_OPTION, title: 'Something else…' } : undefined}
                value={field.value}
                onChange={(option) => {
                  field.onChange(option)
                  onEdited()
                }}
              />
            )}
          />
        </Choices>
        {draft.option === OTHER_OPTION && (
          <Field>
            <Label htmlFor={`${idPrefix}-other`}>In your own words</Label>
            <Input
              id={`${idPrefix}-other`}
              aria-invalid={tooLong}
              aria-describedby={tooLong ? fixId : undefined}
              {...textField('other')}
            />
          </Field>
        )}
        {lengthFix}
        {refusalBanner}
      </>
    )
  }

  if (draft.kind === 'number') {
    const toggleWords = (
      <Controller
        control={control}
        name={`steps.${index}.inWords`}
        render={({ field }) => (
          <LinkButton
            type="button"
            onClick={() => {
              field.onChange(!field.value)
              onEdited()
            }}
          >
            {field.value ? 'Give a number instead' : 'Can’t give a number? Answer in words'}
          </LinkButton>
        )}
      />
    )
    if (draft.inWords) {
      return (
        <>
          <Field>
            <Label htmlFor={`${idPrefix}-words`}>Your answer in words</Label>
            <TextArea
              id={`${idPrefix}-words`}
              aria-invalid={tooLong}
              aria-describedby={tooLong ? fixId : undefined}
              {...textField('words')}
            />
          </Field>
          {lengthFix}
          <Note>This answer reaches the agent and leaves the lot&rsquo;s quantity as it is.</Note>
          {toggleWords}
          {refusalBanner}
        </>
      )
    }

    return (
      <>
        <Field>
          <Label htmlFor={`${idPrefix}-quantity`}>Quantity</Label>
          <Input
            id={`${idPrefix}-quantity`}
            inputMode="decimal"
            aria-invalid={showFix}
            aria-describedby={showFix ? fixId : undefined}
            {...register(`steps.${index}.value`, {
              onChange: onEdited,
            })}
          />
        </Field>
        {showFix && (
          <div id={fixId} role="alert">
            <Banner tone="bad">{NUMBER_FIX}</Banner>
          </div>
        )}
        <Controller
          control={control}
          name={`steps.${index}.basis`}
          render={({ field }) => (
            <SegmentedControl
              label="How was it found"
              options={[
                { id: 'counted', label: 'Counted' },
                { id: 'estimated', label: 'Estimated' },
              ]}
              value={field.value}
              onChange={(basis) => {
                field.onChange(basis)
                onEdited()
              }}
            />
          )}
        />
        {toggleWords}
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
          aria-invalid={tooLong}
          aria-describedby={tooLong ? fixId : undefined}
          {...textField('text')}
        />
      </Field>
      {lengthFix}
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

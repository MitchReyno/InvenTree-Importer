import { useMemo, useState, type Ref } from 'react'
import { SearchablePicker } from './SearchablePicker'

/** One choice the caller already holds, such as an observed record, a lot or a group. */
export type PickerChoice = {
  /** The field's value; an empty string is an ordinary choice, such as "No lot". */
  value: string
  /** The choice's text, which search matches and which names its option. */
  label: string
  /** Listed but not pickable, such as a version that isn't ready. */
  disabled?: boolean
}

type Props = {
  label: string
  choices: readonly PickerChoice[]
  /** The chosen value; one no choice has shows the placeholder. */
  value: string
  onChange: (value: string) => void
  /** Shown while nothing is chosen, such as "Choose a lot…". */
  placeholder: string
  /** Plural noun for the empty-search message, e.g. `lots`. */
  noun: string
  /** Adds "Not chosen" first, which picks the empty value and shows the placeholder. */
  clearable?: boolean
  required?: boolean
  invalid?: boolean
  disabled?: boolean
  status?: string
  labelHidden?: boolean
  compact?: boolean
  inputRef?: Ref<HTMLInputElement>
  className?: string
}

const NOT_CHOSEN: PickerChoice = { value: '', label: 'Not chosen' }

function matches(choice: PickerChoice, words: readonly string[]) {
  const text = choice.label.toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * A searchable choice from a list the caller holds, on `SearchablePicker`: the batch's observed
 * records, its lots, groups and versions. Search keeps the choices whose label holds every typed
 * word, in their own order.
 */
export function ChoicePicker({
  label,
  choices,
  value,
  onChange,
  placeholder,
  noun,
  clearable = false,
  required,
  invalid,
  disabled = false,
  status,
  labelHidden,
  compact,
  inputRef,
  className,
}: Props) {
  const [input, setInput] = useState('')

  const listed = useMemo(
    () => (clearable ? [NOT_CHOSEN, ...choices] : choices),
    [choices, clearable],
  )

  const options = useMemo(() => {
    const words = input.toLowerCase().split(/\s+/).filter(Boolean)
    return listed.filter((choice) => matches(choice, words))
  }, [listed, input])

  // A clearable picker's empty value is "nothing chosen yet", so it shows the placeholder.
  const nothingChosen = clearable && value === ''
  const chosen = nothingChosen ? undefined : listed.find((choice) => choice.value === value)

  return (
    <SearchablePicker<PickerChoice>
      label={label}
      options={options}
      value={chosen ?? null}
      inputValue={input}
      onInputChange={setInput}
      onChange={(choice) => {
        // react-select reports a pick of the chosen option too; that changes nothing.
        if (choice.value !== value) {
          onChange(choice.value)
        }
      }}
      getOptionLabel={(choice) => choice.label}
      getOptionValue={(choice) => choice.value}
      isOptionDisabled={(choice) => choice.disabled === true}
      disabled={disabled}
      noOptionsMessage={() => (input.trim() ? `No ${noun} match` : `No ${noun}`)}
      placeholder={placeholder}
      status={status}
      required={required}
      invalid={invalid}
      labelHidden={labelHidden}
      compact={compact}
      inputRef={inputRef}
      className={className}
    />
  )
}

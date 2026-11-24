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
  disabled?: boolean
  status?: string
  labelHidden?: boolean
  compact?: boolean
  inputRef?: Ref<HTMLInputElement>
  className?: string
}

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
  disabled = false,
  status,
  labelHidden,
  compact,
  inputRef,
  className,
}: Props) {
  const [input, setInput] = useState('')

  const options = useMemo(() => {
    const words = input.toLowerCase().split(/\s+/).filter(Boolean)
    return choices.filter((choice) => matches(choice, words))
  }, [choices, input])

  const chosen = choices.find((choice) => choice.value === value) ?? null

  return (
    <SearchablePicker<PickerChoice>
      label={label}
      options={options}
      value={chosen}
      inputValue={input}
      onInputChange={setInput}
      onChange={(choice) => onChange(choice.value)}
      getOptionLabel={(choice) => choice.label}
      getOptionValue={(choice) => choice.value}
      isOptionDisabled={(choice) => choice.disabled === true}
      disabled={disabled}
      noOptionsMessage={() => (input.trim() ? `No ${noun} match` : `No ${noun}`)}
      placeholder={placeholder}
      status={status}
      labelHidden={labelHidden}
      compact={compact}
      inputRef={inputRef}
      className={className}
    />
  )
}

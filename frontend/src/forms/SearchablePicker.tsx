import { useId, useMemo, type ReactNode } from 'react'
import Select, {
  components,
  type GroupBase,
  type InputActionMeta,
  type InputProps,
  type OptionsOrGroups,
  type StylesConfig,
} from 'react-select'
import styled from 'styled-components'
import {
  color,
  duration,
  easing,
  radius,
  shadow,
  size,
  space,
  typeVar,
} from '#/theme/generated/tokens'
import { Small } from '#/components/ui/primitives'
import { media } from '#/components/ui/media'
import { Label } from './inputs'

export type SearchablePickerProps<O> = {
  label: string
  /** The final list, in order; the picker never filters it, so callers rank and search. */
  options: OptionsOrGroups<O, GroupBase<O>>
  value: O | null
  /** The typed search, held by the caller so it can search with it. */
  inputValue: string
  /** The typed search changed; it is cleared when an option is picked, focus leaves or the menu closes. */
  onInputChange: (input: string) => void
  onChange: (option: O) => void
  /** Each option's text, which is also its accessible name. */
  getOptionLabel: (option: O) => string
  getOptionValue: (option: O) => string
  isOptionDisabled?: (option: O) => boolean
  formatGroupLabel?: (group: GroupBase<O>) => ReactNode
  disabled?: boolean
  loading?: boolean
  loadingMessage?: () => string
  noOptionsMessage: () => string
  placeholder: string
  /** A line below the picker, which also describes it. */
  status?: string
}

/**
 * One searchable single selection, on react-select: the label, the styles, keyboard input and the
 * status line that describes it. Callers own the options, their search and what a pick means.
 */
export function SearchablePicker<O>({
  label,
  options,
  value,
  inputValue,
  onInputChange,
  onChange,
  getOptionLabel,
  getOptionValue,
  isOptionDisabled,
  formatGroupLabel,
  disabled = false,
  loading = false,
  loadingMessage,
  noOptionsMessage,
  placeholder,
  status,
}: SearchablePickerProps<O>) {
  const id = useId()
  const describedBy = `${id}-status`
  // Stable for the picker's life: a new Input component would remount the field and lose focus.
  const parts = useMemo(() => ({ Input: DescribedInput<O> }), [])
  const styles = useMemo(() => pickerStyles<O>(), [])

  function changeInput(next: string, meta: InputActionMeta) {
    if (meta.action === 'input-change') {
      onInputChange(next)
    } else if (
      meta.action === 'set-value' ||
      meta.action === 'input-blur' ||
      meta.action === 'menu-close'
    ) {
      onInputChange('')
    }
  }

  return (
    <Label as="div">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <Select<O, false, GroupBase<O>>
        inputId={id}
        components={parts}
        {...{ statusId: status ? describedBy : undefined }}
        options={options}
        value={value}
        inputValue={inputValue}
        onInputChange={changeInput}
        onChange={(option) => {
          if (option) {
            onChange(option)
          }
        }}
        filterOption={null}
        getOptionLabel={getOptionLabel}
        getOptionValue={getOptionValue}
        isOptionDisabled={isOptionDisabled}
        formatGroupLabel={formatGroupLabel}
        isDisabled={disabled}
        isLoading={loading}
        loadingMessage={loadingMessage}
        noOptionsMessage={noOptionsMessage}
        placeholder={placeholder}
        styles={styles}
      />
      {status && <Status id={describedBy}>{status}</Status>}
    </Label>
  )
}

/** react-select drops `aria-describedby`; append the picker status to its own description. */
function DescribedInput<O>(props: InputProps<O, false, GroupBase<O>>) {
  const statusId = (props.selectProps as { statusId?: string }).statusId
  const own = props['aria-describedby']
  return (
    <components.Input
      {...props}
      aria-describedby={[own, statusId].filter(Boolean).join(' ') || undefined}
    />
  )
}

function pickerStyles<O>(): StylesConfig<O, false, GroupBase<O>> {
  return {
    control: (base, state) => ({
      ...base,
      minHeight: 44,
      borderColor: state.isFocused ? color.accent : color.lineStrong,
      borderRadius: radius.input,
      borderStyle: state.isDisabled ? 'dashed' : 'solid',
      boxShadow: state.isFocused ? `0 0 0 2px ${color.accent}` : 'none',
      '&:hover': { borderColor: state.isFocused ? color.accent : color.lineStrong },
      transition: `border-color ${duration.fast} ${easing.linear}`,
      [media.reducedMotion]: { transition: 'none' },
      background: state.isDisabled ? color.surface2 : color.surface,
    }),
    singleValue: (base, state) => ({
      ...base,
      color: state.isDisabled ? color.muted : color.fg,
    }),
    placeholder: (base) => ({ ...base, color: color.muted }),
    // react-select hides a disabled input, which removes the named combobox from assistive tech.
    input: (base) => ({ ...base, visibility: 'visible', color: color.fg }),
    menu: (base) => ({
      ...base,
      zIndex: 5,
      padding: 4,
      border: `1px solid ${color.line}`,
      borderRadius: radius.card,
      background: color.surface,
      boxShadow: shadow,
    }),
    groupHeading: (base) => ({
      ...base,
      padding: `${space[2]} ${space[4]}`,
      color: color.muted,
      fontSize: typeVar.small.size,
      fontWeight: typeVar.label.weight,
      textTransform: 'none',
    }),
    option: (base, state) => ({
      ...base,
      padding: `${space[3]} ${space[4]}`,
      borderRadius: radius.input,
      overflowWrap: 'anywhere',
      color: state.isDisabled ? color.muted : color.fg,
      background:
        !state.isDisabled && (state.isSelected || state.isFocused)
          ? color.accentWeak
          : 'transparent',
      cursor: state.isDisabled ? 'not-allowed' : 'default',
      transition: `background-color ${duration.fast} ${easing.linear}`,
      ':active': { backgroundColor: color.accentWeak, color: color.fg },
      [media.compact]: { display: 'flex', alignItems: 'center', minHeight: size.touch },
      [media.reducedMotion]: { transition: 'none' },
    }),
    noOptionsMessage: (base) => ({ ...base, color: color.muted }),
  }
}

const Status = styled(Small)`
  font-weight: ${typeVar.body.weight};
`

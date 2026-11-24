import { useId, useMemo, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import Select, {
  type GroupBase,
  type InputActionMeta,
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
  zIndex,
} from '#/theme/generated/tokens'
import { Small } from '#/components/ui/primitives'
import { visuallyHidden } from '#/components/ui/VisuallyHidden'
import { media } from '#/components/ui/media'
import { DescribedInput } from './DescribedInput'
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
  /** The label names the picker for assistive technology but isn't drawn, as in a table row. */
  labelHidden?: boolean
  /** Control height for a row of small buttons; phones keep the touch height. */
  compact?: boolean
  /** Announced on the search field; a form's own rules enforce it. */
  required?: boolean
  invalid?: boolean
  /** The menu opens in a layer over the page, so a scrolling container can't clip it. */
  menuInLayer?: boolean
  /** The search field, for a caller that moves focus to the picker. */
  inputRef?: Ref<HTMLInputElement>
  className?: string
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
  labelHidden = false,
  compact = false,
  required = false,
  invalid = false,
  menuInLayer = false,
  inputRef,
  className,
}: SearchablePickerProps<O>) {
  const id = useId()
  const describedBy = `${id}-status`
  // Stable for the picker's life: a new Input component would remount the field and lose focus.
  const parts = useMemo(() => ({ Input: DescribedInput<O> }), [])
  const styles = useMemo(() => pickerStyles<O>(compact), [compact])

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

  // react-select leaves Enter alone when the open menu has nothing to pick, and a form would
  // take it as a submit; an open menu keeps every Enter.
  function keepEnterInMenu(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.getAttribute('aria-expanded') === 'true') {
      event.preventDefault()
    }
  }

  return (
    // The search text isn't a form value, so its typing stops here rather than reaching a form's
    // change handler; a pick reaches the caller through `onChange`.
    <Label
      as="div"
      className={className}
      onChange={(event) => event.stopPropagation()}
      onKeyDown={keepEnterInMenu}
    >
      <PickerLabel id={`${id}-label`} htmlFor={id} $hidden={labelHidden}>
        {label}
      </PickerLabel>
      <Select<O, false, GroupBase<O>>
        inputId={id}
        components={parts}
        {...{
          statusId: status ? describedBy : undefined,
          searchRef: inputRef,
          announceRequired: required,
        }}
        aria-invalid={invalid || undefined}
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
        // Tab leaves the field, as it does a native select; only Enter or a click picks.
        tabSelectsValue={false}
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
        menuPortalTarget={menuInLayer ? document.body : undefined}
        menuPosition={menuInLayer ? 'fixed' : 'absolute'}
        // A layered menu doesn't follow the page, so scrolling the page closes it.
        closeMenuOnScroll={menuInLayer}
      />
      {status && <Status id={describedBy}>{status}</Status>}
    </Label>
  )
}

function pickerStyles<O>(compact: boolean): StylesConfig<O, false, GroupBase<O>> {
  return {
    control: (base, state) => ({
      ...base,
      minHeight: compact ? size.control : size.touch,
      fontSize: compact ? typeVar.small.size : base.fontSize,
      [media.compact]: { minHeight: size.touch },
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
    menuPortal: (base) => ({ ...base, zIndex: zIndex.popover }),
  }
}

const PickerLabel = styled.label<{ $hidden: boolean }>`
  ${({ $hidden }) => ($hidden ? visuallyHidden : '')}
`

const Status = styled(Small)`
  font-weight: ${typeVar.body.weight};
`

import type { Ref } from 'react'
import { components, type GroupBase, type InputProps } from 'react-select'

/** What `SearchablePicker` passes through react-select's props to its search field. */
export type PickerSelectProps = {
  statusId?: string
  searchRef?: Ref<HTMLInputElement>
  /** Not react-select's own `required`, whose hidden input would block a form's submit. */
  announceRequired?: boolean
}

/**
 * react-select's search field with the picker's status in its description, which react-select
 * drops, and its required state. It owns the input's ref, so the caller's ref is set alongside it.
 */
export function DescribedInput<O>(props: InputProps<O, false, GroupBase<O>>) {
  const { statusId, searchRef, announceRequired } = props.selectProps as PickerSelectProps
  const own = props['aria-describedby']
  const { innerRef } = props

  function setRefs(element: HTMLInputElement | null) {
    for (const ref of [innerRef, searchRef]) {
      if (typeof ref === 'function') {
        ref(element)
      } else if (ref) {
        ref.current = element
      }
    }
  }

  return (
    <components.Input
      {...props}
      innerRef={setRefs}
      aria-required={announceRequired || undefined}
      aria-describedby={[own, statusId].filter(Boolean).join(' ') || undefined}
    />
  )
}

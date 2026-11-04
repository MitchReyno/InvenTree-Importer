import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { CheckboxLabel, Input, Label, Small } from './primitives'

export type SharedTags = { manual: string[]; auto: boolean }

const MAX_TAGS = 32
const MAX_TAG_CHARACTERS = 100

type Props = {
  value: SharedTags
  onChange: (value: SharedTags) => void
  /** Reports typed text not yet added as a tag, so navigation can protect it. */
  onPendingChange?: (pending: boolean) => void
  disabled?: boolean
}

/**
 * Manual shared tags are exact human values; Auto independently asks for reviewed suggestions.
 * Duplicates are compared case-insensitively and the first spelling is kept.
 */
export function SharedTagsInput({ value, onChange, onPendingChange, disabled = false }: Props) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const composing = useRef(false)
  const notify = useRef(onPendingChange)
  notify.current = onPendingChange
  useEffect(() => () => notify.current?.(false), [])

  // Reported from the input event itself, so navigation sees pending text before effects flush.
  function changeDraft(next: string) {
    setDraft(next)
    notify.current?.(next.trim().length > 0)
  }

  const full = value.manual.length >= MAX_TAGS

  function add(text = draft) {
    const tag = text.trim()
    if (!tag) {
      return
    }
    const existing = value.manual.find((item) => item.toLowerCase() === tag.toLowerCase())
    if (existing) {
      setProblem(`“${existing}” is already a tag.`)
      return
    }
    setProblem('')
    changeDraft('')
    onChange({ ...value, manual: [...value.manual, tag] })
  }

  return (
    <Tags role="group" aria-labelledby={`${id}-title`}>
      <Title id={`${id}-title`}>Shared part tags</Title>
      {value.manual.length > 0 && (
        <Chips>
          {value.manual.map((tag) => (
            <Chip key={tag}>
              {tag}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove tag ${tag}`}
                onClick={() =>
                  onChange({ ...value, manual: value.manual.filter((item) => item !== tag) })
                }
              >
                ×
              </button>
            </Chip>
          ))}
        </Chips>
      )}
      <Label>
        Add shared part tag
        <Input
          value={draft}
          disabled={disabled || full}
          maxLength={MAX_TAG_CHARACTERS}
          aria-describedby={`${id}-help`}
          aria-invalid={problem ? true : undefined}
          onChange={(event) => {
            setProblem('')
            const next = event.target.value
            if (next.endsWith(',') && !composing.current) {
              changeDraft(next.slice(0, -1))
              add(next.slice(0, -1))
            } else {
              changeDraft(next)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              add()
            }
          }}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(event) => {
            composing.current = false
            const text = event.currentTarget.value
            if (text.endsWith(',')) {
              changeDraft(text.slice(0, -1))
              add(text.slice(0, -1))
            }
          }}
          onBlur={() => add()}
        />
      </Label>
      {problem && <Small role="alert">{problem}</Small>}
      <Small id={`${id}-help`}>
        Press Enter or comma to add. <span>{`${value.manual.length} of ${MAX_TAGS} tags`}</span>
      </Small>
      <CheckboxLabel>
        <input
          type="checkbox"
          checked={value.auto}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, auto: event.target.checked })}
        />
        Also suggest tags automatically
      </CheckboxLabel>
    </Tags>
  )
}

const Tags = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
`
const Title = styled.span`
  font-size: 14px;
  font-weight: 550;
`
const Chips = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
`
const Chip = styled.li`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 2px 2px 10px;
  border: 1px solid #b9cde7;
  border-radius: 999px;
  background: #edf3fc;
  color: #164a93;
  overflow-wrap: anywhere;
  button {
    min-width: 32px;
    min-height: 32px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
`

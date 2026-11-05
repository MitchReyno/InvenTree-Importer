import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'

type EvidenceGroupProps = {
  name: string
  count: number
  note?: string
  actions?: ReactNode
  dropState?: 'none' | 'over'
  /** Files not yet in a group: a dashed box whose name can't be edited. */
  ungrouped?: boolean
  onRename?: (name: string) => void
  children?: ReactNode
}

function fileCount(count: number) {
  return count === 1 ? '1 file' : `${count} files`
}

/** A drop target holding files that belong together. */
export function EvidenceGroup(props: EvidenceGroupProps) {
  const { name, count, note, actions, dropState = 'none', ungrouped = false, children } = props
  const [draft, setDraft] = useState(name)
  const [shownName, setShownName] = useState(name)
  // The last name sent, so Enter then blur doesn't send it twice before the parent catches up.
  const submitted = useRef<string | null>(null)

  if (shownName !== name) {
    setShownName(name)
    setDraft(name)
  }

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) {
      setDraft(name)
      return
    }
    if (trimmed === submitted.current) {
      return
    }
    submitted.current = trimmed
    props.onRename?.(trimmed)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(name)
    }
  }

  return (
    <Group aria-label={draft || name} $ungrouped={ungrouped} $over={dropState === 'over'}>
      <Header>
        {ungrouped || !props.onRename ? (
          <StaticName>{name}</StaticName>
        ) : (
          <NameField
            aria-label="Group name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commit}
          />
        )}
        <Count>{fileCount(count)}</Count>
        {actions}
      </Header>
      {note && <Note>{note}</Note>}
      {children}
    </Group>
  )
}

const Group = styled.section<{ $ungrouped: boolean; $over: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space['2-5']};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${({ $ungrouped }) =>
    $ungrouped &&
    css`
      border-style: dashed;
      background: transparent;
    `}
  ${({ $over }) =>
    $over &&
    css`
      border-color: ${color.accent};
      box-shadow: 0 0 0 3px ${color.accentWeak};
    `}
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

const NameField = styled.input`
  min-width: 0;
  flex: 1;
  padding: ${space[1]} ${space['1-5']};
  margin-left: -6px;
  border: 1px solid transparent;
  border-radius: ${radius.input};
  background: transparent;
  font-weight: 650;
  &:hover,
  &:focus {
    border-color: ${color.lineStrong};
    background: ${color.surface};
  }
`

const StaticName = styled.span`
  flex: 1;
  font-weight: 650;
`

const Count = styled.span`
  font-size: 12.5px;
  color: ${color.muted};
`

const Note = styled.p`
  margin: 0;
  font-size: 12.5px;
  color: ${color.muted};
`

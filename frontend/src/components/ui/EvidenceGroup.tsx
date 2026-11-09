import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, ring, size, space, typeVar } from '#/theme/generated/tokens'
import { media } from './media'
import { hoverTransition } from './motion'
import { Button } from './Button'
import { useReportDirty } from '#/navigation/useReportDirty'

type EvidenceGroupProps = {
  name: string
  count: number
  /** Shown after the file count, such as "2 lots". */
  meta?: string
  note?: string
  actions?: ReactNode
  dropState?: 'none' | 'over'
  /** Files not yet in a group: a dashed box whose name can't be edited. */
  ungrouped?: boolean
  /** The region's name; defaults to the group name. */
  label?: string
  /** The name field's label; defaults to "Group name". */
  nameLabel?: string
  nameDisabled?: boolean
  onRename?: (name: string) => void
  /** Whether the name field holds an unsaved edit. */
  onDraftChange?: (dirty: boolean) => void
  /** The drop target's element. */
  ref?: Ref<HTMLElement>
  /** -1 lets the region take focus, such as after a tile inside it is removed. */
  tabIndex?: number
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
  // Enter already sent this draft, so the blur that follows must not send it again.
  const sentOnEnter = useRef(false)

  // A new saved name replaces a clean draft, or a draft it came from; another draft is kept.
  if (shownName !== name) {
    setShownName(name)
    if (draft === shownName || draft.trim() === name) {
      setDraft(name)
    }
  }

  const { onDraftChange } = props
  const dirty = draft !== name
  // A saved rename arriving makes the draft clean with no event here, so this follows the name.
  useEffect(() => {
    onDraftChange?.(dirty)
  }, [dirty, onDraftChange])
  useReportDirty(dirty, onDraftChange)

  function changeDraft(next: string) {
    setDraft(next)
    onDraftChange?.(next !== name)
  }

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) {
      changeDraft(name)
      return
    }
    props.onRename?.(trimmed)
  }

  function handleBlur() {
    if (sentOnEnter.current) {
      sentOnEnter.current = false
      return
    }
    commit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // The Enter that confirms an IME candidate is not a commit.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      sentOnEnter.current = true
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      changeDraft(name)
    }
  }

  return (
    <Group
      ref={props.ref}
      aria-label={props.label ?? (draft || name)}
      tabIndex={props.tabIndex}
      $ungrouped={ungrouped}
      $over={dropState === 'over'}
    >
      <Header>
        {ungrouped || !props.onRename ? (
          <StaticName>{name}</StaticName>
        ) : (
          <NameField
            aria-label={props.nameLabel ?? 'Group name'}
            value={draft}
            disabled={props.nameDisabled}
            onChange={(event) => {
              sentOnEnter.current = false
              changeDraft(event.target.value)
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
          />
        )}
        {props.nameDisabled && dirty && (
          // A locked field cannot take Escape, so the draft keeps its own way out.
          <Button size="sm" variant="ghost" onClick={() => changeDraft(name)}>
            Discard name change
          </Button>
        )}
      </Header>
      <Meta>
        <Count>
          {fileCount(count)}
          {props.meta && ` · ${props.meta}`}
        </Count>
        {actions}
      </Meta>
      {note && <Note>{note}</Note>}
      {children}
    </Group>
  )
}

const Group = styled.section<{ $ungrouped: boolean; $over: boolean }>`
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
  gap: ${space[4]};
  padding: ${space[5]};
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
      box-shadow: 0 0 0 ${ring.width} ${color.accentWeak};
    `}
`

const Header = styled.div`
  display: flex;
  min-width: 0;
`

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
`

const NameField = styled.input`
  min-width: 0;
  flex: 1;
  padding: ${space[2]} ${space[3]};
  margin-left: calc(-1 * ${space[3]});
  color: ${color.fg};
  font-size: ${typeVar.h3.size};
  border: 1px solid transparent;
  border-radius: ${radius.input};
  background: transparent;
  font-weight: ${typeVar.h3.weight};
  ${hoverTransition}
  &:hover:not(:disabled),
  &:focus {
    border-color: ${color.lineStrong};
    background: ${color.surface};
  }
  &:disabled {
    color: ${color.fg};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const StaticName = styled.span`
  flex: 1;
  font-weight: ${typeVar.h3.weight};
`

const Count = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Note = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

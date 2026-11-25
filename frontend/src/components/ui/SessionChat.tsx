import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { Button } from './Button'

export type ChatMessage = { id: string; who: string; text: string; mine: boolean }

const PLACEHOLDER = 'Ask why, or tell it what to check next'
const HINT = 'Enter to send · Shift+Enter for a new line'

type SessionChatProps = {
  messages: ChatMessage[]
  onSend: (text: string) => void
  /** Only a cancelled session stops taking messages. */
  disabled?: boolean
  /** Holds the draft but blocks sending, such as while an earlier message is unconfirmed. */
  sendDisabled?: boolean
  label?: string
  maxLength?: number
  /** False where the conversation is shown elsewhere, as on the session page. */
  showLog?: boolean
}

export function SessionChat({
  messages,
  onSend,
  disabled = false,
  sendDisabled = false,
  label = 'Message',
  maxLength,
  showLog = true,
}: SessionChatProps) {
  const inputId = useId()
  const hintId = useId()
  const [draft, setDraft] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sendDisabled) {
      return
    }
    onSend(text)
    setDraft('')
  }

  // Enter sends; Shift+Enter, and Enter while an input method is composing, stay in the box.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return
    }
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <Chat>
      {showLog && (
        <Log role="log" aria-label="Session messages">
          {messages.map((message) => (
            <Message key={message.id} $mine={message.mine}>
              <Who>{message.who}</Who>
              {message.text}
            </Message>
          ))}
        </Log>
      )}
      <Compose onSubmit={handleSubmit}>
        <label htmlFor={inputId}>{label}</label>
        <textarea
          id={inputId}
          rows={2}
          value={draft}
          placeholder={PLACEHOLDER}
          aria-describedby={hintId}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={disabled || sendDisabled || !draft.trim()}
        >
          Send
        </Button>
        <Hint id={hintId}>{HINT}</Hint>
      </Compose>
      {disabled && <Closed>This session was cancelled, so it can’t take messages.</Closed>}
    </Chat>
  )
}

const Chat = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[4]};
`

const Log = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[4]};
`

const Message = styled.p<{ $mine: boolean }>`
  max-width: 85%;
  margin: 0;
  /* A message or answer can hold a long unbroken word, such as a URL. */
  overflow-wrap: anywhere;
  padding: ${space[4]} ${space[5]};
  border-radius: ${radius.card};
  align-self: ${({ $mine }) => ($mine ? 'flex-end' : 'flex-start')};
  background: ${({ $mine }) => ($mine ? color.accentWeak : color.surface2)};
`

const Who = styled.span`
  display: block;
  margin-bottom: ${space[1]};
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.bodyStrong.weight};
  color: ${color.muted};
`

const Compose = styled.form`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]} ${space[3]};
  label {
    flex-basis: 100%;
    font-size: ${typeVar.label.size};
    font-weight: ${typeVar.bodyStrong.weight};
  }
  textarea {
    font: inherit;
    resize: vertical;
    flex: 1;
    min-width: 0;
    padding: calc(${space[4]} - 1px) calc(${space[5]} - 1px);
    border: 1px solid ${color.lineStrong};
    border-radius: ${radius.input};
    background: ${color.surface};
  }
`

const Hint = styled.p`
  flex-basis: 100%;
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Closed = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

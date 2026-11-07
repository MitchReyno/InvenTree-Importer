import { useId, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { Button } from './Button'

export type ChatMessage = { id: string; who: string; text: string; mine: boolean }

type SessionChatProps = {
  messages: ChatMessage[]
  onSend: (text: string) => void
  /** Only a cancelled session stops taking messages. */
  disabled?: boolean
}

export function SessionChat({ messages, onSend, disabled = false }: SessionChatProps) {
  const inputId = useId()
  const [draft, setDraft] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) {
      return
    }
    onSend(text)
    setDraft('')
  }

  return (
    <Chat>
      <Log role="log" aria-label="Session messages">
        {messages.map((message) => (
          <Message key={message.id} $mine={message.mine}>
            <Who>{message.who}</Who>
            {message.text}
          </Message>
        ))}
      </Log>
      <Compose onSubmit={handleSubmit}>
        <label htmlFor={inputId}>Message</label>
        <input
          id={inputId}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="primary" size="sm" disabled={disabled}>
          Send
        </Button>
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
  padding: ${space[4]} ${space[5]};
  border-radius: ${radius.card};
  align-self: ${({ $mine }) => ($mine ? 'flex-end' : 'flex-start')};
  background: ${({ $mine }) => ($mine ? color.accentWeak : color.surface2)};
`

const Who = styled.span`
  display: block;
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 600;
  color: ${color.muted};
`

const Compose = styled.form`
  display: flex;
  gap: ${space[3]};
  label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid ${color.lineStrong};
    border-radius: ${radius.input};
    background: ${color.surface};
  }
`

const Closed = styled.p`
  margin: 0;
  font-size: 12.5px;
  color: ${color.muted};
`

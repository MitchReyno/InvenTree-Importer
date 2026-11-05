import { useRef, useState } from 'react'
import styled from 'styled-components'
import type { SessionStateDto } from '@invimport/contracts'
import { Button, Paragraph, Small } from '../ui/primitives'

interface Props {
  state: SessionStateDto
  /** Queues one message; the key stays the same until the send is confirmed. */
  send: (text: string, key: string) => Promise<unknown>
  startFresh: () => void
}

/** Chat queues in every session state; a cancelled session offers a fresh one instead. */
export function SessionChat({ state, send, startFresh }: Props) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const key = useRef<string | null>(null)
  if (state === 'cancelled') {
    return (
      <Paragraph>
        This session was cancelled.{' '}
        <Button type="button" onClick={startFresh}>
          Start a fresh session
        </Button>
      </Paragraph>
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!text.trim()) {
      return
    }
    key.current ??= crypto.randomUUID()
    setBusy(true)
    setMessage('')
    try {
      await send(text, key.current)
      key.current = null
      setText('')
      setMessage(
        state === 'running'
          ? 'Queued. The agent receives it during this turn.'
          : 'Queued. The session resumes to answer.',
      )
    } catch {
      setMessage('Sending was not confirmed. Your message is kept; send again to retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form onSubmit={submit}>
      <label>
        Message this session
        <textarea
          value={text}
          maxLength={4096}
          rows={2}
          disabled={busy}
          onChange={(event) => {
            key.current = null
            setText(event.target.value)
          }}
        />
      </label>
      <Button type="submit" disabled={busy || !text.trim()}>
        Send
      </Button>
      {message && <Small role="status">{message}</Small>}
    </Form>
  )
}

const Form = styled.form`
  display: grid;
  gap: 6px;
  label {
    display: grid;
    gap: 4px;
  }
`

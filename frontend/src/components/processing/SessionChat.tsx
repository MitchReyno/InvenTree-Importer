import { useRef, useState } from 'react'
import styled from 'styled-components'
import type { SessionStateDto } from '@invimport/contracts'
import { Button, Paragraph, Small } from '../ui/primitives'

interface Props {
  /** Identifies the session, so an unconfirmed send survives leaving and returning. */
  storeKey: string
  state: SessionStateDto
  /** Queues one message; the same key is reused only to retry that exact message. */
  send: (text: string, key: string) => Promise<unknown>
  startFresh: () => void
}

interface Pending {
  text: string
  key: string
}

/** Unconfirmed sends outlive the composer, for as long as the page is open. */
const pendingSends = new Map<string, Pending>()

/**
 * Chat queues in every session state; a cancelled session offers a fresh one instead. A send
 * whose result is unknown stays pending with its own key until it is confirmed or discarded, so
 * new drafting never reuses or abandons it.
 */
export function SessionChat({ storeKey, state, send, startFresh }: Props) {
  const [draft, setDraft] = useState('')
  const [pending, setPendingState] = useState<Pending | null>(
    () => pendingSends.get(storeKey) ?? null,
  )

  const setPending = (value: Pending | null) => {
    if (value) {
      pendingSends.set(storeKey, value)
    } else {
      pendingSends.delete(storeKey)
    }
    setPendingState(value)
  }

  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
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

  const deliver = async (item: Pending, fromDraft: boolean) => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setBusy(true)
    setMessage('')
    try {
      await send(item.text, item.key)
      setPending(null)
      if (fromDraft) {
        setDraft('')
      }
      setMessage(
        state === 'running'
          ? 'Queued. The agent receives it during this turn.'
          : 'Queued. The session resumes to answer.',
      )
    } catch {
      setPending(item)
      if (fromDraft) {
        setDraft('')
      }
      setMessage('')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (draft.trim() && !pending) {
      void deliver({ text: draft, key: crypto.randomUUID() }, true)
    }
  }

  return (
    <Form onSubmit={submit}>
      {pending && (
        <Unconfirmed role="alert">
          Sending “{pending.text}” was not confirmed. It may already be queued.
          <span>
            <Button type="button" disabled={busy} onClick={() => void deliver(pending, false)}>
              Retry this message
            </Button>{' '}
            <Button type="button" disabled={busy} onClick={() => setPending(null)}>
              Discard
            </Button>
          </span>
        </Unconfirmed>
      )}
      <label>
        Message this session
        <textarea
          value={draft}
          maxLength={4096}
          rows={2}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <Button type="submit" disabled={busy || !draft.trim() || pending !== null}>
        Send
      </Button>
      {pending && <Small>Retry or discard the unconfirmed message before sending another.</Small>}
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

const Unconfirmed = styled.div`
  display: grid;
  gap: 6px;
`

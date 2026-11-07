import { useState, useSyncExternalStore } from 'react'
import styled from 'styled-components'
import type { SessionStateDto } from '@invimport/contracts'
import { Button, Paragraph, Small } from '../ui/primitives'

interface Props {
  /** Identifies the session, so a send in flight or unconfirmed survives leaving and returning. */
  storeKey: string
  state: SessionStateDto
  /** Queues one message; the same key is reused only to retry that exact message. */
  send: (text: string, key: string) => Promise<unknown>
  freshDisabled?: boolean
  startFresh: () => void
}

interface Pending {
  text: string
  key: string
  status: 'sending' | 'unconfirmed'
}

/**
 * Sends outlive the composer for as long as the page is open. An entry is written before the
 * request starts and removed only when it is confirmed or explicitly discarded.
 */
const pendingSends = new Map<string, Pending>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const update = (storeKey: string, value: Pending | undefined) => {
  if (value) {
    pendingSends.set(storeKey, value)
  } else {
    pendingSends.delete(storeKey)
  }
  listeners.forEach((listener) => listener())
}

async function deliver(
  storeKey: string,
  item: Omit<Pending, 'status'>,
  send: Props['send'],
): Promise<boolean> {
  update(storeKey, { ...item, status: 'sending' })
  try {
    await send(item.text, item.key)
    update(storeKey, undefined)
    return true
  } catch {
    update(storeKey, { ...item, status: 'unconfirmed' })
    return false
  }
}

const confirmation: Partial<Record<SessionStateDto, string>> = {
  running: 'Queued. The agent receives it during this turn.',
  failed: 'Queued. This session stopped with an error, so start a fresh session to continue.',
  resume_unavailable:
    'Queued. This session cannot be resumed, so start a fresh session to continue.',
  waiting_for_login: 'Queued. Sign the agent in again, then start a fresh session to continue.',
}

/** What a queued message means for a session in this state. */
export function chatConfirmation(state: SessionStateDto) {
  return confirmation[state] ?? 'Queued. The session resumes to answer.'
}

/** Chat queues in every session state; a cancelled session offers a fresh one instead. */
export function SessionChat({ storeKey, state, send, startFresh, freshDisabled }: Props) {
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const pending = useSyncExternalStore(subscribe, () => pendingSends.get(storeKey))
  if (state === 'cancelled') {
    return (
      <Paragraph>
        This session was cancelled.{' '}
        <Button type="button" onClick={startFresh} disabled={freshDisabled}>
          Start a fresh session
        </Button>
      </Paragraph>
    )
  }

  const confirmed = () => setMessage(chatConfirmation(state))

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || pendingSends.has(storeKey)) {
      return
    }
    const text = draft
    setDraft('')
    setMessage('')
    void deliver(storeKey, { text, key: crypto.randomUUID() }, send).then((ok) => ok && confirmed())
  }

  const sending = pending?.status === 'sending'
  return (
    <Form onSubmit={submit}>
      {['resume_unavailable', 'failed', 'interrupted', 'waiting_for_login'].includes(state) && (
        <Paragraph>
          This session needs a fresh conversation. History and queued messages will be kept.{' '}
          <Button
            type="button"
            onClick={startFresh}
            disabled={freshDisabled || pending !== undefined}
          >
            Start a fresh session
          </Button>
        </Paragraph>
      )}
      {pending?.status === 'unconfirmed' && (
        <Unconfirmed role="alert">
          Sending “{pending.text}” was not confirmed. It may already be queued.
          <span>
            <Button
              type="button"
              onClick={() => void deliver(storeKey, pending, send).then((ok) => ok && confirmed())}
            >
              Retry this message
            </Button>{' '}
            <Button type="button" onClick={() => update(storeKey, undefined)}>
              Discard
            </Button>
          </span>
        </Unconfirmed>
      )}
      {sending && <Small role="status">Sending “{pending.text}”…</Small>}
      <label>
        Message this session
        <textarea
          value={draft}
          maxLength={4096}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <Button type="submit" disabled={!draft.trim() || pending !== undefined}>
        Send
      </Button>
      {pending?.status === 'unconfirmed' && (
        <Small>Retry or discard the unconfirmed message before sending another.</Small>
      )}
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

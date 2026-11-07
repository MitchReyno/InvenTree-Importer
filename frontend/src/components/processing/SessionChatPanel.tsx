import { useState, useSyncExternalStore } from 'react'
import styled from 'styled-components'
import { space } from '../../theme/generated/tokens'
import type { SessionStateDto, SessionTimelineDto } from '@invimport/contracts'
import { SessionChat, type ChatMessage } from '../ui/SessionChat'
import { Paragraph, Small } from '../ui/primitives'
import { Button } from '../ui/Button'

interface Props {
  /** Identifies the session, so a send in flight or unconfirmed survives leaving and returning. */
  storeKey: string
  state: SessionStateDto
  messages?: ChatMessage[]
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

type Timeline = SessionTimelineDto

/** The session's conversation, oldest first: the operator's messages and answers, the replies. */
export function chatMessages(timeline: Timeline): ChatMessage[] {
  return [
    ...timeline.inbox
      .filter((item) => item.kind === 'chat' || item.kind === 'answer')
      .map((item) => ({
        id: `in:${item.seq}`,
        at: item.created_at,
        who: 'You',
        mine: true,
        text:
          item.kind === 'chat'
            ? (item.payload as { text: string }).text
            : `Answered: ${answerText(item.payload)}`,
      })),
    ...timeline.outbox
      .filter((item) => item.kind === 'reply')
      .map((item) => ({
        id: `out:${item.seq}`,
        at: item.created_at,
        who: 'Agent',
        mine: false,
        text: (item.payload as { text: string }).text,
      })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ id, who, mine, text }) => ({ id, who, mine, text }))
}

function answerText(payload: unknown) {
  const value = (payload as { value: { kind: string; value?: string; text?: string } }).value
  return value.kind === 'quantity' ? `${value.value}` : (value.text ?? '')
}

/**
 * The drawer's chat: `ui/SessionChat` for the conversation and composer, with the send kept
 * until it is confirmed. Chat queues in every session state; a cancelled session offers a
 * fresh one instead.
 */
export function SessionChatPanel({
  storeKey,
  state,
  messages = [],
  send,
  startFresh,
  freshDisabled,
}: Props) {
  const [message, setMessage] = useState('')
  const pending = useSyncExternalStore(subscribe, () => pendingSends.get(storeKey))
  if (state === 'cancelled') {
    return (
      <Panel>
        <Paragraph>
          This session was cancelled.{' '}
          <Button type="button" onClick={startFresh} disabled={freshDisabled}>
            Start a fresh session
          </Button>
        </Paragraph>
        <SessionChat messages={messages} onSend={() => {}} label="Message this session" disabled />
      </Panel>
    )
  }

  const confirmed = () => setMessage(chatConfirmation(state))

  const submit = (text: string) => {
    if (pendingSends.has(storeKey)) {
      return
    }
    setMessage('')
    void deliver(storeKey, { text, key: crypto.randomUUID() }, send).then((ok) => ok && confirmed())
  }

  const sending = pending?.status === 'sending'
  return (
    <Panel>
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
      <SessionChat
        messages={messages}
        onSend={submit}
        sendDisabled={pending !== undefined}
        label="Message this session"
        maxLength={4096}
      />
      {pending?.status === 'unconfirmed' && (
        <Small>Retry or discard the unconfirmed message before sending another.</Small>
      )}
      {message && <Small role="status">{message}</Small>}
    </Panel>
  )
}

const Panel = styled.div`
  display: grid;
  gap: ${space[3]};
`

const Unconfirmed = styled.div`
  display: grid;
  gap: ${space[3]};
`

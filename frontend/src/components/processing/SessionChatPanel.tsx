import { useState } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type { SessionStateDto } from '@invimport/contracts'
import { SessionChat, Paragraph, Small, Button } from '#/components/ui'
import {
  hasPendingSend,
  setPendingSend,
  usePendingSend,
  type PendingSend,
} from '#/processing/pending-sends'

interface Props {
  /** Identifies the session, so a send in flight or unconfirmed survives leaving and returning. */
  storeKey: string
  state: SessionStateDto
  /** Queues one message; the same key is reused only to retry that exact message. */
  send: (text: string, key: string) => Promise<unknown>
  freshDisabled?: boolean
  /** Why Start fresh would be refused now; the button is disabled and says so. */
  freshReason?: string
  startFresh: () => void
  /** The message box's label; the session page names its step. */
  label?: string
  /** Why a message can't be sent now, such as while the page's Processing read is pending. */
  sendUnavailable?: string
}

async function deliver(
  storeKey: string,
  item: Omit<PendingSend, 'status'>,
  send: Props['send'],
): Promise<boolean> {
  setPendingSend(storeKey, { ...item, status: 'sending' })
  try {
    await send(item.text, item.key)
    setPendingSend(storeKey, undefined)
    return true
  } catch {
    setPendingSend(storeKey, { ...item, status: 'unconfirmed' })
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

/**
 * The message box under a session's history: `ui/SessionChat`'s composer, with the send kept
 * until it is confirmed; the history shows the message itself, "Sending…" until then. Chat queues in every session state; a cancelled session offers a
 * fresh one instead.
 */
export function SessionChatPanel({
  storeKey,
  state,
  send,
  startFresh,
  freshDisabled,
  freshReason,
  label = 'Message this session',
  sendUnavailable,
}: Props) {
  const [message, setMessage] = useState('')
  const pending = usePendingSend(storeKey)
  if (state === 'cancelled') {
    return (
      <Panel>
        <Paragraph>
          This session was cancelled.{' '}
          <Button
            type="button"
            onClick={startFresh}
            disabled={freshDisabled}
            disabledReason={freshReason}
          >
            Start a fresh session
          </Button>
        </Paragraph>
        <SessionChat
          messages={[]}
          onSend={() => {}}
          label={label}
          showLog={false}
          disabled
        />
      </Panel>
    )
  }

  const confirmed = () => setMessage(chatConfirmation(state))

  const submit = (text: string) => {
    if (hasPendingSend(storeKey) || sendUnavailable) {
      return
    }
    setMessage('')
    void deliver(storeKey, { text, key: crypto.randomUUID() }, send).then((ok) => ok && confirmed())
  }

  return (
    <Panel>
      {['resume_unavailable', 'failed', 'interrupted', 'waiting_for_login'].includes(state) && (
        <Paragraph>
          This session needs a fresh conversation. History and queued messages will be kept.{' '}
          <Button
            type="button"
            onClick={startFresh}
            disabled={freshDisabled || pending !== undefined}
            disabledReason={freshReason}
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
              disabled={sendUnavailable !== undefined}
              onClick={() => void deliver(storeKey, pending, send).then((ok) => ok && confirmed())}
            >
              Retry this message
            </Button>{' '}
            <Button type="button" onClick={() => setPendingSend(storeKey, undefined)}>
              Discard
            </Button>
          </span>
        </Unconfirmed>
      )}
      <SessionChat
        messages={[]}
        onSend={submit}
        sendDisabled={pending !== undefined || sendUnavailable !== undefined}
        label={label}
        showLog={false}
        maxLength={4096}
      />
      {pending?.status === 'unconfirmed' && (
        <Small>Retry or discard the unconfirmed message before sending another.</Small>
      )}
      {sendUnavailable && <Small>{sendUnavailable}</Small>}
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

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import { examineLead } from '#/processing/source'
import { confirmPending, editPending, pendingMessage, sendKey } from '#/processing/pending-messages'
import type { ProcessingClient } from '#/processing/types'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { color, radius, space } from '#/theme/generated/tokens'
import { useRetainedPollInterval } from '#/components/operations/LiveUpdates'
import { chatConfirmation } from '#/components/processing/SessionChatPanel'
import { Button, Label, Small, TextArea } from '#/components/ui'

/**
 * Review › Map's instruction to the lot-forming agent, sent as chat to the batch's Examine lead
 * session. It appears only while that session can take one: a cancelled session is restarted from
 * Processing instead.
 */
export function TellExamine({
  batchId,
  processing,
  onDirtyChange,
}: {
  batchId: string
  processing: ProcessingClient | undefined
  /** Reports unsent text to the navigation guard. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const storeKey = `${batchId}:examine-lead`
  const scope = useServerScope()
  const pollInterval = useRetainedPollInterval()
  const [text, setText] = useState(() => pendingMessage(storeKey).text)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const snapshot = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batchId),
    queryFn: () => processing!.read(batchId),
    enabled: Boolean(processing?.chat),
    refetchInterval: pollInterval,
  })
  const lead = snapshot.data ? examineLead(snapshot.data) : null
  const chat = processing?.chat
  const visible = Boolean(chat && lead?.session_state && lead.session_state !== 'cancelled')
  // Unsent text is unsaved work only while the form is shown; hiding or leaving reports clean.
  const dirty = visible && Boolean(text.trim())
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  if (!lead?.session_state || lead.session_state === 'cancelled' || !chat) {
    return null
  }
  const state = lead.session_state

  async function send() {
    setBusy(true)
    setOutcome(null)
    setFailed(false)
    const key = sendKey(storeKey, text)
    try {
      await chat!.call(
        processing,
        batchId,
        lead!.id,
        { idempotency_key: key, text: text.trim() },
        key,
      )
      confirmPending(storeKey)
      setText('')
      setOutcome(chatConfirmation(state))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <Label>
        Instruction for Examine
        <TextArea
          value={text}
          rows={2}
          maxLength={4096}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value)
            editPending(storeKey, event.target.value)
            setOutcome(null)
            setFailed(false)
          }}
        />
      </Label>
      <Row>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          Tell Examine
        </Button>
        {outcome && <Small role="status">{outcome}</Small>}
        {failed && (
          <Small role="alert">
            The instruction was not confirmed and may already be queued. It is kept here; sending it
            again cannot queue it twice.
          </Small>
        )}
      </Row>
    </Form>
  )
}

const Form = styled.form`
  display: grid;
  gap: ${space[4]};
  padding: ${space[6]};
  border-radius: ${radius.btn};
  background: ${color.surface2};
`
const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

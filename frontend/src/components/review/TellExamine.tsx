import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import type { ProcessingClient } from '../../processing/types'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { space } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Label, Small, TextArea } from '../ui/primitives'

/**
 * Review › Map's instruction to the lot-forming agent, sent as chat to the batch's Examine lead
 * session. It appears only once that session exists.
 */
export function TellExamine({
  batchId,
  processing,
}: {
  batchId: string
  processing: ProcessingClient | undefined
}) {
  const scope = useServerScope()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'sent' | 'failed' | null>(null)
  const snapshot = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batchId),
    queryFn: () => processing!.read(batchId),
    enabled: Boolean(processing?.chat),
  })
  const lead = snapshot.data?.jobs.find(
    (job) => job.stage === 'examine' && job.subject_id === null && job.session_state,
  )
  const chat = processing?.chat
  if (!lead || !chat) {
    return null
  }

  async function send() {
    setBusy(true)
    setOutcome(null)
    const key = crypto.randomUUID()
    try {
      await chat!.call(
        processing,
        batchId,
        lead!.id,
        { idempotency_key: key, text: text.trim() },
        key,
      )
      setText('')
      setOutcome('sent')
    } catch {
      setOutcome('failed')
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
            setOutcome(null)
          }}
        />
      </Label>
      <Row>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          Tell Examine
        </Button>
        {outcome === 'sent' && (
          <Small role="status">Sent to Examine; it reads it on its next turn.</Small>
        )}
        {outcome === 'failed' && (
          <Small role="alert">The instruction was not sent. It is kept here to try again.</Small>
        )}
      </Row>
    </Form>
  )
}

const Form = styled.form`
  display: grid;
  gap: ${space[2]};
`
const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { confirmPending, editPending, pendingMessage, sendKey } from '#/processing/pending-messages'
import { space } from '#/theme/generated/tokens'
import { Button, Small } from '#/components/ui'
import { TextArea } from '#/forms'

/**
 * Asks the step that proposed a field, through its session's inbox. "Asked" stays until the
 * field's value changes; the reply itself is in the session drawer in Processing. An unsent
 * message and its key are kept (by `storeKey`) when the record closes, and count as unsaved work.
 */
export function AskControl({
  step,
  value,
  prefill,
  storeKey,
  send,
  report,
}: {
  step: string
  value: string | null
  prefill: string
  storeKey: string
  send: (text: string, key: string) => Promise<void>
  report?: (dirty: boolean) => void
}) {
  const kept = pendingMessage(storeKey).text
  const [open, setOpen] = useState(Boolean(kept))
  const [text, setText] = useState(kept || prefill)
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(false)
  const [failed, setFailed] = useState(false)
  const askedValue = useRef(value)
  const focus = useRef<'asked' | 'ask' | 'message' | null>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const askedRef = useRef<HTMLElement>(null)
  const askRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (asked && value !== askedValue.current) {
      setAsked(false)
    }
  }, [asked, value])
  useEffect(() => {
    report?.(open)
  }, [open, report])
  useEffect(() => () => report?.(false), [report])
  useEffect(() => {
    if (focus.current === 'asked') {
      askedRef.current?.focus()
    } else if (focus.current === 'message') {
      messageRef.current?.focus()
    } else if (focus.current === 'ask') {
      askRef.current?.querySelector('button')?.focus()
    }
    focus.current = null
  })

  if (asked) {
    return (
      <Small role="status" tabIndex={-1} ref={askedRef}>
        Asked {step}
      </Small>
    )
  }
  if (!open) {
    return (
      <span ref={askRef}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            focus.current = 'message'
            setOpen(true)
          }}
        >
          Ask {step}
        </Button>
      </span>
    )
  }
  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setFailed(false)
        const message = text.trim()
        send(message, sendKey(storeKey, text))
          .then(() => {
            confirmPending(storeKey)
            askedValue.current = value
            focus.current = 'asked'
            setAsked(true)
            setOpen(false)
          })
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }}
    >
      <TextArea
        ref={messageRef}
        aria-label={`Message to ${step}`}
        value={text}
        rows={2}
        maxLength={4096}
        disabled={busy}
        onChange={(event) => {
          setText(event.target.value)
          editPending(storeKey, event.target.value)
        }}
      />
      <Row>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          Send to {step}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            editPending(storeKey, '')
            setText(prefill)
            focus.current = 'ask'
            setOpen(false)
          }}
        >
          Cancel
        </Button>
        {failed && (
          <Small role="alert">
            Not confirmed, and it may already be queued. Sending again cannot queue it twice.
          </Small>
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
  gap: ${space[2]};
`

import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { confirmPending, editPending, pendingMessage, sendKey } from '#/processing/pending-messages'
import { space } from '#/theme/generated/tokens'
import { Button, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { useReportDirty } from '#/navigation/useReportDirty'
import { useAsyncAction } from '#/lifecycle/useAsyncAction'

const NOT_CONFIRMED =
  'Not confirmed, and it may already be queued. Sending again cannot queue it twice.'

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
  const [asked, setAsked] = useState(false)
  const { busy, error, run } = useAsyncAction()
  // The field value the ask was about; a different value means the answer may have arrived.
  const [askedValue, setAskedValue] = useState(value)
  const focus = useRef<'asked' | 'ask' | 'message' | null>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const askedRef = useRef<HTMLElement>(null)
  const askRef = useRef<HTMLSpanElement>(null)

  if (asked && value !== askedValue) {
    setAsked(false)
  }
  useReportDirty(open, report)

  function changeOpen(next: boolean) {
    setOpen(next)
    report?.(next)
  }

  async function ask(key: string) {
    await send(text.trim(), key)
    confirmPending(storeKey)
    setAskedValue(value)
    focus.current = 'asked'
    setAsked(true)
    changeOpen(false)
  }

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
            changeOpen(true)
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
        // Made before the run, so a failure to make a key is not reported as a possibly queued send.
        const key = sendKey(storeKey, text)
        void run(() => ask(key), NOT_CONFIRMED)
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
            changeOpen(false)
          }}
        >
          Cancel
        </Button>
        {error && <Small role="alert">{error}</Small>}
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
